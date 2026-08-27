import { readdir } from "node:fs/promises";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { sha256 } from "../ingestion/hash.js";
import { enqueueIngestJob } from "../jobs/queue.js";

const SUPPORTED_EXT = new Set([".pdf", ".txt", ".md", ".docx"]);

/**
 * On API boot (after migrate), scan the bundled dataset dirs and enqueue
 * one job per file. Idempotent twice over - content-hash dedup in the DB
 * and jobId dedup in BullMQ (see plan/03) - so restarting compose
 * re-enqueues nothing and spends no API calls.
 */
export async function enqueueBootstrapDataset(): Promise<void> {
  const dirs = [env.INGESTION_DOCS_DIR, env.INGESTION_TRANSCRIPTS_DIR];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      logger.warn({ dir, err: err instanceof Error ? err.message : String(err) }, "bootstrap dataset dir unreadable, skipping");
      continue;
    }

    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (!SUPPORTED_EXT.has(ext)) continue;

      const filePath = path.join(dir, entry);
      const buf = await readFile(filePath);
      const contentHash = sha256(buf);

      const { deduplicated } = await enqueueIngestJob({
        filePath,
        originalName: entry,
        contentHash,
        origin: "bootstrap",
      });

      logger.info({ file: entry, deduplicated }, "bootstrap file enqueued");
    }
  }
}
