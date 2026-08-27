import { Queue, QueueEvents } from "bullmq";
import { redis } from "../redis.js";
import { INGEST_QUEUE_NAME, type IngestJobData } from "./types.js";

// Shared singletons - BullMQ requires maxRetriesPerRequest: null on any
// connection it manages, already set on the shared `redis` client.
export const ingestQueue = new Queue<IngestJobData>(INGEST_QUEUE_NAME, { connection: redis });

// QueueEvents is already a Redis pub/sub bridge - the API subscribes and
// fans out to SSE clients rather than writing custom pub/sub (see plan/03).
export const ingestQueueEvents = new QueueEvents(INGEST_QUEUE_NAME, { connection: redis });

export async function enqueueIngestJob(data: IngestJobData): Promise<{ jobId: string; deduplicated: boolean }> {
  // jobId = contentHash -> duplicate uploads are rejected by BullMQ
  // automatically (see plan/03).
  const existingJob = await ingestQueue.getJob(data.contentHash);
  if (existingJob) {
    return { jobId: data.contentHash, deduplicated: true };
  }

  await ingestQueue.add("ingest", data, {
    jobId: data.contentHash,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: false,
  });

  return { jobId: data.contentHash, deduplicated: false };
}
