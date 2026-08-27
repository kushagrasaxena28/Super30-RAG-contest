import { Worker } from "bullmq";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { prisma } from "../db/prisma.js";
import { redis } from "../redis.js";
import { INGEST_QUEUE_NAME } from "../jobs/types.js";
import { processIngestJob } from "../jobs/ingestJob.js";
import { ingestQueue } from "../jobs/queue.js";

/**
 * Boot reconciliation: any Source left in `processing` with no active job
 * gets marked `failed` so it can be retried rather than blocking silently
 * (see plan/03) - this covers a worker that was killed mid-job (e.g.
 * `docker compose down` mid-ingest).
 */
async function reconcileStuckSources(): Promise<void> {
  const stuck = await prisma.source.findMany({ where: { status: "processing" } });
  for (const source of stuck) {
    const job = await ingestQueue.getJob(source.contentHash);
    const state = job ? await job.getState() : null;
    if (state === "active" || state === "waiting" || state === "delayed") continue;

    await prisma.source.update({
      where: { id: source.id },
      data: { status: "failed", error: "Worker restarted mid-ingest; source needs re-upload." },
    });
    logger.warn({ sourceId: source.id }, "reconciled stuck source to failed");
  }
}

async function main() {
  await reconcileStuckSources();

  const worker = new Worker(INGEST_QUEUE_NAME, processIngestJob, {
    connection: redis,
    concurrency: env.WORKER_CONCURRENCY,
  });

  worker.on("completed", (job) => logger.info({ jobId: job.id }, "job completed"));
  worker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, err: err.message }, "job failed"),
  );

  logger.info({ concurrency: env.WORKER_CONCURRENCY }, "worker ready");

  async function shutdown(signal: string) {
    logger.info({ signal }, "worker shutting down");
    // Finishes in-flight jobs, stops accepting new ones - without this a
    // SIGTERM mid-job leaves a source stuck in `processing` forever.
    await worker.close();
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "worker failed to start");
  process.exit(1);
});
