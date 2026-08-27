import { env } from "../../config/env.js";
import { postJson } from "./http.js";
import type { EmbeddingProvider, EmbedKind } from "./types.js";

const URL = "https://api.jina.ai/v1/embeddings";

interface JinaResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/**
 * jina-embeddings-v3 uses task-specific LoRA adapters rather than an
 * input_type flag; `retrieval.passage` / `retrieval.query` are the asymmetric
 * pair, equivalent in intent to Voyage's document/query input types (plan/04).
 */
const TASK: Record<EmbedKind, string> = {
  document: "retrieval.passage",
  query: "retrieval.query",
};

/**
 * Third option, useful mainly because its free tier needs no card and no
 * Google account - a key is issued straight from jina.ai. 1024 dimensions is
 * v3's native size, so unlike Gemini there is no truncation to compensate for.
 */
export const jinaProvider: EmbeddingProvider = {
  id: "jina",
  model: "jina-embeddings-v3",
  dim: 1024,

  apiKeyVar: "JINA_API_KEY",
  apiKeyUrl: "https://jina.ai/embeddings/",
  getApiKey: () => env.JINA_API_KEY,

  defaultRpm: 60,
  // Jina's free allowance is a total token grant, not a per-minute budget, so
  // there is no sensible TPM default - the RPM bucket alone paces it.
  maxBatchTexts: 64,
  maxBatchTokens: 30_000,

  async embedBatch(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const json = await postJson<JinaResponse>({
      providerId: "jina",
      url: URL,
      headers: { Authorization: `Bearer ${env.JINA_API_KEY ?? ""}` },
      body: {
        model: jinaProvider.model,
        task: TASK[kind],
        dimensions: jinaProvider.dim,
        input: texts,
      },
    });

    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  },
};
