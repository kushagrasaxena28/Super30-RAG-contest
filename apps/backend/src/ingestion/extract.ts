import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import { IngestionError } from "./errors.js";
import { MIN_EXTRACTABLE_WORDS } from "../config/constants.js";

const execFileAsync = promisify(execFile);

const PDFTOTEXT_TIMEOUT_MS = 30_000;

export type DetectedType = "pdf" | "txt" | "docx";

/**
 * Extension + magic-byte sniff. Extension alone is trivially spoofed (see
 * plan/09-hardening.md #2) - both must agree with what we're willing to
 * process, and neither is trusted for the shell-out path below.
 */
export function detectType(originalName: string, buf: Buffer): DetectedType {
  const ext = path.extname(originalName).toLowerCase();

  const isPdfMagic = buf.subarray(0, 4).toString("latin1") === "%PDF";
  const isZipMagic = buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  if (ext === ".pdf" && isPdfMagic) return "pdf";
  if ((ext === ".txt" || ext === ".md") && !isPdfMagic && !isZipMagic) return "txt";
  if (ext === ".docx" && isZipMagic) return "docx";

  throw new IngestionError(
    `Unsupported or spoofed file type for "${path.basename(originalName)}" (ext=${ext})`,
    false,
    415,
  );
}

/**
 * File on disk -> plain text. Callers must have already written the
 * upload to a `{uuid}.{ext}` path in UPLOAD_DIR - the original filename is
 * never used as a path (see plan/09-hardening.md #1).
 */
export async function extractText(storedFilePath: string, type: DetectedType): Promise<string> {
  let text: string;

  switch (type) {
    case "pdf": {
      try {
        // argv array, no shell - a malicious filename cannot inject
        // commands here even though it never reaches this call anyway
        // (storedFilePath is our own uuid-based path, not user input).
        const { stdout } = await execFileAsync("pdftotext", ["-layout", storedFilePath, "-"], {
          timeout: PDFTOTEXT_TIMEOUT_MS,
          maxBuffer: 64 * 1024 * 1024,
        });
        text = stdout;
      } catch (err) {
        throw new IngestionError(
          `pdftotext failed: ${err instanceof Error ? err.message : String(err)}`,
          false,
          400,
        );
      }
      break;
    }
    case "docx": {
      const buf = await readFile(storedFilePath);
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value;
      break;
    }
    case "txt": {
      text = await readFile(storedFilePath, "utf8");
      break;
    }
  }

  const wordCount = countWords(text);
  if (wordCount < MIN_EXTRACTABLE_WORDS) {
    // Not doing OCR - a scanned/image-only PDF extracts to ~0 words and
    // must fail loudly rather than silently ingest an empty source.
    throw new IngestionError(
      `Extracted only ${wordCount} words (minimum ${MIN_EXTRACTABLE_WORDS}) - likely a scanned/image document. OCR is not supported.`,
      false,
      400,
    );
  }

  return text;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
