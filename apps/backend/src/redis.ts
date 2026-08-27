import { Redis } from "ioredis";
import { env } from "./config/env.js";

// Shared by BullMQ (jobs/queue.ts, phase 03), the embedding cache
// (embeddings/cache.ts, phase 04), and rate limiting (phase 09).
// BullMQ requires maxRetriesPerRequest: null on any connection it manages.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export async function redisHealthy(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
