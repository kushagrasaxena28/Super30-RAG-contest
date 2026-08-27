// EMBEDDING_DIM deliberately does NOT live here any more. Embeddings are
// pluggable (EMBEDDING_PROVIDER), so the dimension is a property of the
// selected provider and is exported from src/embeddings/index.ts. A constant
// here could silently disagree with the vectors actually being produced, which
// surfaces only as an opaque Qdrant insert failure - the exact failure the
// {model, dim} boot marker in src/db/qdrant.ts exists to prevent.

export const QDRANT_DISTANCE = "Cosine" as const;

// Final candidate budget handed to the generator, regardless of retrieval
// strategy (see plan/05-retrieval.md) - this is the concrete answer to
// "never send the whole corpus to the LLM."
export const RETRIEVAL_CANDIDATE_LIMIT = 15;

export const DEFAULT_HYBRID_K = 8;
export const BROAD_THEME_DETAIL_K = 10;

// Reciprocal Rank Fusion constant (see plan/05-retrieval.md).
export const RRF_K = 60;

export const TRANSCRIPT_TURN_WINDOW = 8;
export const TRANSCRIPT_TURN_OVERLAP = 2;

// Any file whose extracted word count is below this skips segmentation
// entirely and becomes one chunk (see plan/02-ingestion.md router).
export const WHOLE_DOC_WORD_THRESHOLD = 400;

export const MAX_GENERATION_RETRIES = 1; // bounded, not agentic (see plan/06)
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MIN_EXTRACTABLE_WORDS = 50; // below this, extraction is treated as failed (likely scanned/image PDF)
