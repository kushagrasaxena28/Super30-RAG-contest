import { env } from "../../config/env.js";
import { voyageProvider } from "./voyage.js";
import { geminiProvider } from "./gemini.js";
import { jinaProvider } from "./jina.js";
import type { EmbeddingProvider, EmbeddingProviderId } from "./types.js";

export type { EmbeddingProvider, EmbeddingProviderId, EmbedKind } from "./types.js";
export { estimateTokens } from "./types.js";

const PROVIDERS: Record<EmbeddingProviderId, EmbeddingProvider> = {
  voyage: voyageProvider,
  gemini: geminiProvider,
  jina: jinaProvider,
};

/**
 * Selected once at module load. The zod schema can't do this check itself:
 * which key is required depends on EMBEDDING_PROVIDER, and a generic zod issue
 * dump ("VOYAGE_API_KEY: Required") is actively misleading when the operator
 * asked for Gemini. So the keys are all optional in the schema and the real
 * requirement is enforced here, with a message that names the one variable
 * that is actually missing and says where to get it.
 */
function selectProvider(): EmbeddingProvider {
  const provider = PROVIDERS[env.EMBEDDING_PROVIDER];

  if (!provider.getApiKey()) {
    const alternatives = (Object.keys(PROVIDERS) as EmbeddingProviderId[]).join(", ");
    console.error(
      `EMBEDDING_PROVIDER is "${provider.id}" but ${provider.apiKeyVar} is not set.\n` +
        `  Fix: set ${provider.apiKeyVar} in your .env - get a key at ${provider.apiKeyUrl}\n` +
        `  Or:  set EMBEDDING_PROVIDER to one of: ${alternatives} (and set that provider's key).\n` +
        `  Note: switching providers changes the stored vectors' model. The Qdrant\n` +
        `        collection carries a {model, dim} marker and will refuse to boot against\n` +
        `        vectors from a different model - recreate it and re-ingest after a switch.`,
    );
    process.exit(1);
  }

  return provider;
}

export const embeddingProvider: EmbeddingProvider = selectProvider();
