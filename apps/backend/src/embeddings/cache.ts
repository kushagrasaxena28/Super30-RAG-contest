import { createHash } from "node:crypto";
import { redis } from "../redis.js";

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days - dev-iteration cache, not correctness-critical

/** Identifies the exact vector space a cached embedding belongs to. */
export interface CacheIdentity {
  providerId: string;
  model: string;
  dim: number;
}

function cacheKey(identity: CacheIdentity, text: string): string {
  const hash = createHash("sha256").update(text).digest("hex");
  // Provider id, model AND dimension are all part of the key. Model alone is
  // not enough once providers are pluggable: two providers can be configured
  // at different output dimensions, and a dimension change alone would
  // otherwise serve back vectors of the wrong shape that only fail later, at
  // Qdrant insert, with an opaque error
  // (see plan/04-embeddings-and-storage.md).
  return `emb:${identity.providerId}:${identity.model}:${identity.dim}:${hash}`;
}

export async function getCachedEmbedding(identity: CacheIdentity, text: string): Promise<number[] | null> {
  const raw = await redis.get(cacheKey(identity, text));
  if (!raw) return null;
  try {
    const vector = JSON.parse(raw) as number[];
    // Defensive: a key collision or a hand-edited Redis value must not become
    // a wrong-dimension upsert further down the pipeline.
    return vector.length === identity.dim ? vector : null;
  } catch {
    return null;
  }
}

export async function setCachedEmbedding(identity: CacheIdentity, text: string, vector: number[]): Promise<void> {
  await redis.set(cacheKey(identity, text), JSON.stringify(vector), "EX", TTL_SECONDS);
}
