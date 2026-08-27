import { env } from "../../config/env.js";
import { postJson } from "./http.js";
import type { EmbeddingProvider, EmbedKind } from "./types.js";

const URL = "https://api.voyageai.com/v1/embeddings";

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/**
 * Anthropic's recommended embedding partner (plan/00-architecture.md decision
 * record). Voyage returns unit-length vectors, so no normalization is needed.
 *
 * The 3 RPM / 10K TPM defaults are the free tier WITHOUT a payment method on
 * file - which is what a reviewer following the README will actually have.
 * With a card attached the limits are far higher; raise EMBEDDING_RATE_LIMIT_RPM
 * rather than editing this.
 */
export const voyageProvider: EmbeddingProvider = {
  id: "voyage",
  model: "voyage-4-large",
  dim: 1024,

  apiKeyVar: "VOYAGE_API_KEY",
  apiKeyUrl: "https://dashboard.voyageai.com/",
  getApiKey: () => env.VOYAGE_API_KEY,

  defaultRpm: 3,
  defaultTpm: 10_000,

  maxBatchTexts: 64,
  // Held under the 10K/min token budget so a single batch can never be
  // individually unsatisfiable against the tokens-per-minute bucket.
  maxBatchTokens: 8_000,

  async embedBatch(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const json = await postJson<VoyageResponse>({
      providerId: "voyage",
      url: URL,
      headers: { Authorization: `Bearer ${env.VOYAGE_API_KEY ?? ""}` },
      body: {
        input: texts,
        model: voyageProvider.model,
        // Asymmetric input types - a query embedded through the document path
        // measurably degrades retrieval (plan/04).
        input_type: kind,
        output_dimension: voyageProvider.dim,
      },
    });

    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  },
};
