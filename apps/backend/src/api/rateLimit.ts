import type { Request, RequestHandler } from "express";
import { env } from "../config/env.js";
import { tryConsume, type BucketConfig } from "../ratelimit/tokenBucket.js";

/**
 * Per-IP rate limit for the two endpoints that cost real money on the way in
 * (plan/09-hardening.md #6). Hand-rolled on the same Redis token bucket the
 * outbound provider limits use, rather than adding express-rate-limit: the
 * codebase is deliberately dependency-light (no LangChain either - see the
 * decision record in plan/00-architecture.md), and reusing the bucket means
 * one implementation and one Lua script to reason about.
 *
 * Non-blocking, unlike the outbound buckets: a caller over the limit gets a
 * 429 immediately. Holding an HTTP request open until a token frees up would
 * just convert a rate limit into a timeout.
 */

/** /api/ask - the expensive path: query analysis + 1-2 generation calls. */
export const ASK_BUCKET: BucketConfig = {
  name: "http:ask",
  refillPerMinute: env.ASK_RATE_LIMIT_RPM,
  capacity: env.ASK_RATE_LIMIT_BURST ?? env.ASK_RATE_LIMIT_RPM,
};

/** /api/upload - each accepted request enqueues a full ingestion pipeline. */
export const UPLOAD_BUCKET: BucketConfig = {
  name: "http:upload",
  refillPerMinute: env.UPLOAD_RATE_LIMIT_RPM,
  capacity: env.UPLOAD_RATE_LIMIT_BURST ?? env.UPLOAD_RATE_LIMIT_RPM,
};

/**
 * req.ip is the socket peer unless Express is told to trust a proxy, which it
 * deliberately is not: honouring X-Forwarded-For without a trusted proxy in
 * front lets any caller spoof their way into a fresh bucket. Behind a real
 * proxy, set `app.set("trust proxy", ...)` to the specific hop count first.
 */
function subjectFor(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function perIpRateLimit(bucket: BucketConfig): RequestHandler {
  return (req, res, next) => {
    tryConsume(bucket, 1, subjectFor(req))
      .then((decision) => {
        if (decision.allowed) {
          next();
          return;
        }

        const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
        res.setHeader("Retry-After", String(retryAfterSeconds));
        // Matches the structured error shape used everywhere else in the API
        // (see the error handler in src/api/app.ts).
        res.status(429).json({
          error: {
            code: "rate_limited",
            message: `Too many requests. Retry in ${retryAfterSeconds}s.`,
            details: { retryAfterSeconds, limitPerMinute: bucket.refillPerMinute },
          },
        });
      })
      // tryConsume already fails open on a Redis error; this only catches a
      // genuine programming fault, which belongs in the error handler.
      .catch(next);
  };
}
