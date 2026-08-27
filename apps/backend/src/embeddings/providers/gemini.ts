import { env } from "../../config/env.js";
import { EmbeddingProviderError, postJson } from "./http.js";
import { l2Normalize, type EmbeddingProvider, type EmbedKind } from "./types.js";

const MODEL = "gemini-embedding-001";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`;

/**
 * batchEmbedContents caps the number of per-item requests in one call. 100 is
 * the documented/observed cap; exceeding it returns a 400 naming the limit, so
 * if that ever changes the error message says the new number.
 */
const MAX_REQUESTS_PER_CALL = 100;

interface GeminiResponse {
  embeddings?: Array<{ values: number[] }>;
}

const TASK_TYPE: Record<EmbedKind, string> = {
  document: "RETRIEVAL_DOCUMENT",
  query: "RETRIEVAL_QUERY",
};

/**
 * Google AI Studio embeddings. The reason this provider exists: Voyage's
 * no-payment-method free tier is 3 requests/minute, which makes both bulk
 * ingestion and a live demo impractical. Gemini's free tier is ~100 RPM.
 *
 * CRITICAL: gemini-embedding-001 returns L2-normalized vectors ONLY at its
 * native 3072 dimensions. At any truncated outputDimensionality (we use 1024
 * to match the other providers and the existing Qdrant collection) the vectors
 * come back UNNORMALIZED, and Matryoshka truncation changes their norms
 * unevenly. Cosine distance in Qdrant tolerates that, but normalizing here is
 * the correct fix and keeps the stored vectors interchangeable in shape with
 * every other provider's.
 */
export const geminiProvider: EmbeddingProvider = {
  id: "gemini",
  model: MODEL,
  dim: 1024,

  apiKeyVar: "GEMINI_API_KEY",
  apiKeyUrl: "https://aistudio.google.com/apikey",
  getApiKey: () => env.GEMINI_API_KEY,

  defaultRpm: 100,
  defaultTpm: 30_000,

  maxBatchTexts: MAX_REQUESTS_PER_CALL,
  maxBatchTokens: 20_000,

  async embedBatch(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const json = await postJson<GeminiResponse>({
      providerId: "gemini",
      url: URL,
      // x-goog-api-key rather than ?key= - an API key in a query string ends
      // up in proxy and access logs (plan/09-hardening.md #5).
      headers: { "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
      body: {
        requests: texts.map((text) => ({
          model: `models/${MODEL}`,
          content: { parts: [{ text }] },
          taskType: TASK_TYPE[kind],
          outputDimensionality: geminiProvider.dim,
        })),
      },
    });

    const embeddings = json.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      throw new EmbeddingProviderError(
        "gemini",
        null,
        `gemini returned ${embeddings.length} embeddings for ${texts.length} inputs`,
      );
    }

    // batchEmbedContents preserves request order, so index alignment is the
    // only correspondence available - there are no per-item indices to sort by.
    return embeddings.map((e) => l2Normalize(e.values));
  },
};
