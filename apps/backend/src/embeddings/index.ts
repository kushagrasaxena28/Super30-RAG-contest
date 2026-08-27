import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { consume, type BucketConfig } from "../ratelimit/tokenBucket.js";
import { getCachedEmbedding, setCachedEmbedding, type CacheIdentity } from "./cache.js";
import { embeddingProvider, estimateTokens } from "./providers/index.js";

export type { EmbedKind } from "./providers/types.js";
import type { EmbedKind } from "./providers/types.js";

/**
 * The one-file seam plan/00-architecture.md promised ("Voyage AI for
 * embeddings, behind a one-file interface. Swappable in one file"). The actual
 * provider is chosen by EMBEDDING_PROVIDER; everything below this line - and
 * every call site outside src/embeddings/ - is provider-agnostic.
 *
 * EMBEDDING_MODEL and EMBEDDING_DIM are now DERIVED from the active provider
 * rather than hardcoded. EMBEDDING_DIM in particular drives the Qdrant
 * collection size and its {model, dim} boot marker (src/db/qdrant.ts); a
 * hardcoded 1024 there would silently disagree with a provider configured at
 * another dimension and only surface as an opaque insert failure.
 */
export const EMBEDDING_PROVIDER_ID = embeddingProvider.id;
export const EMBEDDING_MODEL = embeddingProvider.model;
export const EMBEDDING_DIM = embeddingProvider.dim;

export type EmbedFn = (texts: string[], kind: EmbedKind) => Promise<number[][]>;

const MAX_INFLIGHT_BATCHES = 3;

const CACHE_IDENTITY: CacheIdentity = {
  providerId: embeddingProvider.id,
  model: embeddingProvider.model,
  dim: embeddingProvider.dim,
};

/**
 * Requests/minute, shared across every process and every worker job (see
 * src/ratelimit/tokenBucket.ts). The default is the selected provider's known
 * free-tier limit - notably 3 RPM for Voyage without a payment method, which
 * is the reason the provider abstraction exists at all.
 *
 * Keyed by provider id so switching providers doesn't inherit the previous
 * one's half-drained bucket.
 */
const RPM_BUCKET: BucketConfig = {
  name: `emb:${embeddingProvider.id}:rpm`,
  refillPerMinute: env.EMBEDDING_RATE_LIMIT_RPM ?? embeddingProvider.defaultRpm,
  capacity: env.EMBEDDING_RATE_LIMIT_BURST ?? env.EMBEDDING_RATE_LIMIT_RPM ?? embeddingProvider.defaultRpm,
};

/**
 * Tokens/minute is the binding constraint on Voyage's free tier (10K/min), not
 * request count: three 64-chunk requests would be well inside 3 RPM and still
 * return 429 on tokens. Only created when the provider (or the operator)
 * publishes a per-minute token budget.
 */
const TPM_LIMIT = env.EMBEDDING_RATE_LIMIT_TPM ?? embeddingProvider.defaultTpm;
const TPM_BUCKET: BucketConfig | null = TPM_LIMIT
  ? { name: `emb:${embeddingProvider.id}:tpm`, refillPerMinute: TPM_LIMIT, capacity: TPM_LIMIT }
  : null;

/**
 * `kind` matters and is easy to miss: every provider here uses asymmetric
 * document/query representations, so a query embedded through the document
 * path measurably degrades retrieval (plan/04-embeddings-and-storage.md).
 *
 * Cache-checked per text before any network call; only cache misses are
 * batched and sent, with bounded in-flight concurrency.
 */
export const embed: EmbedFn = async (texts, kind) => {
  if (texts.length === 0) return [];

  const cached = await Promise.all(texts.map((t) => getCachedEmbedding(CACHE_IDENTITY, t)));
  const results: (number[] | null)[] = cached.slice();
  const missingIndices = results.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);

  if (missingIndices.length > 0) {
    const missingTexts = missingIndices.map((i) => texts[i]!);
    const batches = buildBatches(missingTexts);

    const embedded = await runBounded(batches, MAX_INFLIGHT_BATCHES, (batch) => callProvider(batch, kind));

    let cursor = 0;
    for (const batchResult of embedded) {
      for (const vector of batchResult) {
        const originalIndex = missingIndices[cursor]!;
        results[originalIndex] = vector;
        void setCachedEmbedding(CACHE_IDENTITY, missingTexts[cursor]!, vector);
        cursor++;
      }
    }
  }

  return results as number[][];
};

/**
 * Two caps, not one. Text count is the endpoint's hard limit (Gemini's
 * batchEmbedContents rejects more than 100 per call); estimated tokens keeps a
 * single request from being individually larger than the whole per-minute
 * token budget, which would make it permanently unsatisfiable against
 * TPM_BUCKET no matter how long we waited.
 */
function buildBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const text of texts) {
    const tokens = estimateTokens(text);
    const wouldExceed =
      current.length >= embeddingProvider.maxBatchTexts ||
      (current.length > 0 && currentTokens + tokens > embeddingProvider.maxBatchTokens);

    if (wouldExceed) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(text);
    currentTokens += tokens;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

async function callProvider(batch: string[], kind: EmbedKind): Promise<number[][]> {
  // Wait for capacity BEFORE the request. The provider's own 429 handler is
  // the safety net for when the bucket's idea of the limit is optimistic; this
  // bucket is what stops parallel worker jobs from getting there in the first
  // place (plan/09-hardening.md #6).
  await consume(RPM_BUCKET, 1);
  if (TPM_BUCKET) {
    await consume(TPM_BUCKET, batch.reduce((sum, t) => sum + estimateTokens(t), 0));
  }

  const vectors = await embeddingProvider.embedBatch(batch, kind);

  const wrongDim = vectors.find((v) => v.length !== embeddingProvider.dim);
  if (wrongDim) {
    // Caught here rather than as an opaque Qdrant insert failure much later.
    throw new Error(
      `${embeddingProvider.id}/${embeddingProvider.model} returned a ${wrongDim.length}-dimension vector, expected ${embeddingProvider.dim}`,
    );
  }

  logger.debug(
    { provider: embeddingProvider.id, kind, batchSize: batch.length },
    "embedding batch complete",
  );

  return vectors;
}

async function runBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
