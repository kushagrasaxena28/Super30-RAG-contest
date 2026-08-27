import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureQdrantCollection } from "../db/qdrant.js";
import { logger } from "../logger.js";

const execFileAsync = promisify(execFile);

/**
 * One-shot: `prisma migrate deploy` + ensure the Qdrant collection exists,
 * then exit. Run as the compose `migrate` service so api/worker never race
 * each other on the migration lock (see plan/01-foundation.md).
 */
async function main() {
  logger.info("running prisma migrate deploy");
  // argv array, no shell - see plan/09-hardening.md on command injection.
  const { stdout, stderr } = await execFileAsync("bunx", ["prisma", "migrate", "deploy"]);
  if (stdout.trim()) logger.info(stdout.trim());
  if (stderr.trim()) logger.warn(stderr.trim());

  logger.info("ensuring qdrant collection exists");
  await withRetries(ensureQdrantCollection, { attempts: 10, delayMs: 2000 });

  logger.info("migration complete");
}

async function withRetries<T>(fn: () => Promise<T>, opts: { attempts: number; delayMs: number }): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      logger.warn({ attempt: i + 1, err }, "retrying");
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }
  }
  throw lastErr;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "migration failed");
    process.exit(1);
  });
