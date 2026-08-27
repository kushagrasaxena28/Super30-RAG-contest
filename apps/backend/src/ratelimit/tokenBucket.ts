import type { Redis } from "ioredis";
import { redis } from "../redis.js";
import { logger } from "../logger.js";

/**
 * Redis-backed token bucket (plan/09-hardening.md #6, plan/00-architecture.md
 * "What Redis buys beyond the queue").
 *
 * It lives in Redis rather than in-process for one specific reason: the worker
 * runs WORKER_CONCURRENCY jobs in parallel and the API embeds queries in a
 * third process. An in-process limiter would let three parallel BullMQ jobs
 * each think they were under the limit while collectively blowing it - which
 * is exactly the failure this exists to prevent.
 *
 * The refill+take is a single Lua script because it is a read-modify-write on
 * shared state. Doing it as GET-then-SET in JS is racy under exactly the
 * concurrency this is meant to bound, so it would defeat the purpose.
 */

// KEYS[1] = bucket key
// ARGV = capacity, refillPerSec, requested, ttlMs
//
// Time comes from Redis TIME rather than the caller so that api and worker
// (separate processes, possibly separate containers) share one clock.
const TAKE_SCRIPT = `
local capacity     = tonumber(ARGV[1])
local refillPerSec = tonumber(ARGV[2])
local requested    = tonumber(ARGV[3])
local ttlMs        = tonumber(ARGV[4])

-- A cost larger than the bucket could never be satisfied; clamping keeps
-- blocking callers from waiting forever on an impossible request.
if requested > capacity then requested = capacity end

local t = redis.call('TIME')
local nowMs = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)

local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])

if tokens == nil or ts == nil then
  tokens = capacity
  ts = nowMs
end

local elapsedMs = nowMs - ts
if elapsedMs < 0 then elapsedMs = 0 end
tokens = math.min(capacity, tokens + (elapsedMs / 1000) * refillPerSec)

local allowed = 0
local retryAfterMs = 0
if tokens >= requested then
  allowed = 1
  tokens = tokens - requested
else
  retryAfterMs = math.ceil(((requested - tokens) / refillPerSec) * 1000)
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', nowMs)
redis.call('PEXPIRE', KEYS[1], ttlMs)

return { allowed, retryAfterMs, math.floor(tokens) }
`;

interface BucketRedis extends Redis {
  tokenBucketTake(
    key: string,
    capacity: string,
    refillPerSec: string,
    requested: string,
    ttlMs: string,
  ): Promise<[number, number, number]>;
}

const client = redis as BucketRedis;
client.defineCommand("tokenBucketTake", { numberOfKeys: 1, lua: TAKE_SCRIPT });

export interface BucketConfig {
  /** Namespace for the Redis key, e.g. "emb:voyage:rpm". */
  name: string;
  /** Maximum tokens the bucket holds - this is the allowed burst. */
  capacity: number;
  /** Tokens added per minute - this is the sustained rate. */
  refillPerMinute: number;
}

export interface BucketDecision {
  allowed: boolean;
  /** Milliseconds until the request would succeed. 0 when allowed. */
  retryAfterMs: number;
  remaining: number;
}

/** Idle buckets expire rather than accumulating one key per IP forever. */
function ttlMsFor(cfg: BucketConfig): number {
  const refillWindowMs = (cfg.capacity / cfg.refillPerMinute) * 60_000;
  return Math.max(60_000, Math.ceil(refillWindowMs * 2));
}

function keyFor(cfg: BucketConfig, subject?: string): string {
  return subject ? `rl:${cfg.name}:${subject}` : `rl:${cfg.name}`;
}

/**
 * Non-blocking take. `subject` partitions one config into many buckets - used
 * for per-IP HTTP limits, omitted for the shared provider-wide buckets.
 *
 * Fails OPEN on a Redis error: a limiter that hard-fails every request when
 * Redis hiccups is a worse outcome than briefly not limiting.
 */
export async function tryConsume(cfg: BucketConfig, cost = 1, subject?: string): Promise<BucketDecision> {
  try {
    const [allowed, retryAfterMs, remaining] = await client.tokenBucketTake(
      keyFor(cfg, subject),
      String(cfg.capacity),
      String(cfg.refillPerMinute / 60),
      String(Math.max(1, Math.ceil(cost))),
      String(ttlMsFor(cfg)),
    );
    return { allowed: allowed === 1, retryAfterMs, remaining };
  } catch (err) {
    logger.warn(
      { bucket: cfg.name, err: err instanceof Error ? err.message : String(err) },
      "token bucket unavailable, failing open",
    );
    return { allowed: true, retryAfterMs: 0, remaining: cfg.capacity };
  }
}

export class RateLimitWaitError extends Error {
  constructor(bucket: string, waitedMs: number) {
    super(`Rate limit bucket "${bucket}" did not free up within ${waitedMs}ms`);
    this.name = "RateLimitWaitError";
  }
}

/** Never sleep longer than this in one go, so a clock/config oddity can't wedge a worker slot. */
const MAX_SLEEP_MS = 30_000;

/**
 * Blocking take, for outbound API calls that should wait their turn rather
 * than fail. Bounded by maxWaitMs so a misconfigured bucket surfaces as an
 * error instead of an indefinitely stuck ingestion job.
 */
export async function consume(cfg: BucketConfig, cost = 1, maxWaitMs = 120_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;

  for (;;) {
    const decision = await tryConsume(cfg, cost);
    if (decision.allowed) return;

    const remainingBudget = deadline - Date.now();
    if (remainingBudget <= 0 || decision.retryAfterMs > remainingBudget) {
      throw new RateLimitWaitError(cfg.name, maxWaitMs);
    }

    // +25ms so we wake up just after the token actually lands rather than
    // spinning on a boundary rounding error.
    const sleepMs = Math.min(decision.retryAfterMs + 25, MAX_SLEEP_MS, remainingBudget);
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}
