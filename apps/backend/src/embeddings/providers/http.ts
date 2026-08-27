import { logger } from "../../logger.js";

/**
 * Shared POST helper for every embedding provider: timeout, 429/5xx retry
 * with Retry-After support, and error messages that never echo request bodies
 * (chunk text is sensitive - plan/09-hardening.md #5).
 *
 * Retries are deliberately SHORT. plan/09-hardening.md #6 warns that SDK-level
 * and BullMQ-level retries compound: BullMQ already gives each ingestion job
 * 3 attempts with exponential backoff, so burning a long retry ladder here
 * multiplies into 9+ attempts and minutes of a wedged worker slot. Three
 * attempts absorbs a single transient 429; anything worse is BullMQ's problem.
 */
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 65_000;
const REQUEST_TIMEOUT_MS = 60_000;

export class EmbeddingProviderError extends Error {
  /** Set from the response's Retry-After header when the provider sent one. */
  retryAfterMs?: number;

  constructor(
    public readonly providerId: string,
    public readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "EmbeddingProviderError";
  }
}

export interface PostJsonOptions {
  providerId: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export async function postJson<T>(opts: PostJsonOptions): Promise<T> {
  let lastError: EmbeddingProviderError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(backoffMs(attempt, lastError));
    }

    let res: Response;
    try {
      res = await fetch(opts.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...opts.headers },
        body: JSON.stringify(opts.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network failure / timeout - transient, worth the remaining attempts.
      lastError = new EmbeddingProviderError(
        opts.providerId,
        null,
        `${opts.providerId} embeddings request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (res.ok) return (await res.json()) as T;

    const bodyText = await res.text().catch(() => "");
    lastError = new EmbeddingProviderError(
      opts.providerId,
      res.status,
      `${opts.providerId} embeddings request failed (${res.status}): ${bodyText.slice(0, 500)}`,
    );

    if (!isRetryableStatus(res.status)) throw lastError;

    lastError.retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), bodyText);
    logger.warn(
      {
        provider: opts.providerId,
        status: res.status,
        attempt: attempt + 1,
        retryAfterMs: lastError.retryAfterMs ?? null,
      },
      "embedding provider throttled or unavailable, retrying",
    );
  }

  throw lastError ?? new EmbeddingProviderError(opts.providerId, null, `${opts.providerId} embeddings request failed`);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/** `Retry-After` is either delta-seconds or an HTTP-date; both are legal. Also parses JSON body for delay hints. */
function parseRetryAfter(header: string | null, bodyText?: string): number | undefined {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);

    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), MAX_BACKOFF_MS);
  }

  if (bodyText) {
    const match = bodyText.match(/retry in ([\d\.]+)s/i);
    if (match) {
      const s = Number(match[1]);
      if (Number.isFinite(s) && s > 0) return Math.min(Math.ceil(s * 1000) + 1000, MAX_BACKOFF_MS);
    }
  }

  return undefined;
}

/**
 * Honour the server's own Retry-After when it sent one; otherwise exponential
 * backoff with full jitter, so parallel worker jobs that were throttled
 * together don't retry in lockstep and throttle each other again.
 */
function backoffMs(attempt: number, lastError: EmbeddingProviderError | null): number {
  if (lastError?.retryAfterMs !== undefined) return lastError.retryAfterMs;
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
