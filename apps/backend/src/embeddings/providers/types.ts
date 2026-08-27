export type EmbedKind = "document" | "query";

export type EmbeddingProviderId = "voyage" | "gemini" | "jina";

/**
 * The seam plan/04-embeddings-and-storage.md promised ("swapping providers
 * touches this file only"). Each provider owns its own model id, dimension
 * and free-tier limits so nothing downstream hardcodes a number that can
 * silently disagree with the vectors actually being written.
 */
export interface EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  readonly model: string;
  /** Drives the Qdrant collection size and the {model, dim} boot marker. */
  readonly dim: number;

  /** Exact env var name, used verbatim in the fail-fast startup error. */
  readonly apiKeyVar: string;
  /** Where a reviewer gets a key - also quoted in the startup error. */
  readonly apiKeyUrl: string;
  readonly getApiKey: () => string | undefined;

  /** Free-tier requests/minute. Deliberately the conservative published number. */
  readonly defaultRpm: number;
  /** Free-tier tokens/minute, when the provider publishes one. */
  readonly defaultTpm?: number;

  /** Hard cap on inputs the endpoint accepts in one request. */
  readonly maxBatchTexts: number;
  /** Soft cap on estimated tokens per request, to stay under per-minute token budgets. */
  readonly maxBatchTokens: number;

  embedBatch(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

/**
 * Qdrant is configured for Cosine, which is scale-invariant, so this is a
 * no-op for providers that already return unit vectors. It is NOT optional
 * for gemini-embedding-001 below 3072 dimensions - see gemini.ts.
 */
export function l2Normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const v of vector) sumSquares += v * v;
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

/**
 * Cheap character-based token estimate. Only used for batch sizing and the
 * tokens/minute bucket, where being roughly right and conservative beats
 * paying for a real tokenizer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
