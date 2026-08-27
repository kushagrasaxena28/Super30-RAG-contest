import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile, mkdir, unlink } from "node:fs/promises";
import { env } from "../../config/env.js";
import { MAX_UPLOAD_BYTES } from "../../config/constants.js";
import { prisma } from "../../db/prisma.js";
import { sha256 } from "../../ingestion/hash.js";
import { detectType } from "../../ingestion/extract.js";
import { IngestionError } from "../../ingestion/errors.js";
import { deleteChunksForSource } from "../../storage/writeChunks.js";
import { enqueueIngestJob } from "../../jobs/queue.js";

export const uploadRouter = Router();

const ALLOWED_EXT = new Set([".pdf", ".txt", ".md", ".docx"]);

await mkdir(env.UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: env.UPLOAD_DIR,
  filename: (_req, file, cb) => {
    // Never persist the client-supplied filename as a path (see
    // plan/09-hardening.md #1) - store as {uuid}.{ext}, keep the original
    // name as data only (Source.filename).
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const base = path.basename(file.originalname);
    if (base !== file.originalname || base.includes("..")) {
      cb(new IngestionError("Invalid filename", false, 400));
      return;
    }
    const ext = path.extname(base).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      cb(new IngestionError(`Unsupported file type: ${ext}`, false, 415));
      return;
    }
    cb(null, true);
  },
});

uploadRouter.post("/upload", (req, res, next) => {
  upload.single("file")(req, res, async (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: { code: "file_too_large", message: `File exceeds ${MAX_UPLOAD_BYTES} bytes` } });
      }
      if (err instanceof IngestionError) {
        return res.status(err.httpStatus ?? 400).json({ error: { code: "invalid_upload", message: err.message } });
      }
      return next(err);
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: { code: "missing_file", message: "No file provided (expected multipart field \"file\")" } });
    }

    try {
      const buf = await readFile(file.path);

      // Magic-byte sniff - extension alone is trivially spoofed (see
      // plan/09-hardening.md #2).
      detectType(file.originalname, buf);

      const contentHash = sha256(buf);
      const existingSource = await prisma.source.findUnique({ where: { contentHash } });

      if (existingSource && existingSource.status !== "failed") {
        await unlink(file.path).catch(() => {});
        return res.status(202).json({ jobId: contentHash, status: "queued", deduplicated: true, sourceId: existingSource.id });
      }

      if (existingSource && existingSource.status === "failed") {
        // Allow a clean retry by re-uploading the same file.
        await deleteChunksForSource(existingSource.id).catch(() => {});
        await prisma.source.delete({ where: { id: existingSource.id } }).catch(() => {});
      }

      const { jobId, deduplicated } = await enqueueIngestJob({
        filePath: file.path,
        originalName: file.originalname,
        contentHash,
        origin: "upload",
      });

      res.status(202).json({ jobId, status: "queued", deduplicated });
    } catch (err) {
      await unlink(file.path).catch(() => {});
      if (err instanceof IngestionError) {
        return res.status(err.httpStatus ?? 400).json({ error: { code: "invalid_upload", message: err.message } });
      }
      next(err);
    }
  });
});
