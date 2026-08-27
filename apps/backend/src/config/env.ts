import { z } from "zod";

/**
 * `.env` files spell "not set" as `FOO=` far more often than by omitting the
 * line - .env.example itself ships `VOYAGE_API_KEY=` for the reviewer to fill
 * in. Without this, an unfilled key parses as "" and produces a zod issue
 * ("Too small: expected string to have >=1 characters") instead of the
 * targeted, actionable startup error in
 * src/embeddings/providers/index.ts. Treat empty as absent.
 */
const blankIsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const optionalSecret = () => blankIsUnset(z.string().min(1).optional());
const optionalCount = () => blankIsUnset(z.coerce.number().int().positive().optional());
const countWithDefault = (fallback: number) =>
  blankIsUnset(z.coerce.number().int().positive().default(fallback));

const EnvSchema = z.object({
  // Which LLM src/llm/ actually calls for classification, transcript
  // speaker-labeling, query analysis and answer generation. Defaults to
  // gemini: its free tier needs no payment method, so a reviewer can clone
  // and run with a single key and no billing setup.
  LLM_PROVIDER: z.enum(["gemini", "anthropic"]).default("gemini"),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  ANTHROPIC_API_KEY: optionalSecret(),

  // Which embedding provider src/embeddings/ actually calls. Also defaults
  // to gemini, so GEMINI_API_KEY alone is enough to run the whole system.
  EMBEDDING_PROVIDER: z.enum(["voyage", "gemini", "jina"]).default("gemini"),

  // Provider keys are optional HERE on purpose: only the selected
  // provider's key is required. We enforce the active provider's key on boot.
  VOYAGE_API_KEY: optionalSecret(),
  GEMINI_API_KEY: optionalSecret(),
  JINA_API_KEY: optionalSecret(),

  DATABASE_URL: z.string().min(1),
  QDRANT_URL: z.string().min(1),
  QDRANT_COLLECTION: z.string().default("case_chunks"),
  REDIS_URL: z.string().min(1),

  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),

  // Auto-ingest the bundled dataset on API boot. OFF by default: the app is
  // meant to start empty so a reviewer uploads their own files from the chat
  // UI and watches them get classified and indexed, which is the flow the
  // brief actually asks to be tested. Set true to preload docs/ instead.
  BOOTSTRAP_DATASET: blankIsUnset(
    z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  ),
  INGESTION_DOCS_DIR: z.string().default("/data/docs/docs_for_test"),
  INGESTION_TRANSCRIPTS_DIR: z.string().default("/data/docs/transcriptions_for_test"),
  UPLOAD_DIR: z.string().default("/data/uploads"),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  CONVERSATION_TOKEN_BUDGET: z.coerce.number().int().positive().default(120_000),

  // --- Rate limiting (plan/09-hardening.md #6) ---
  // Every bucket is {refill per minute = sustained rate, burst = capacity}.
  // Burst left unset defaults to the RPM, i.e. one minute's worth up front.
  // These are shared across processes via Redis, not per-process.

  // Embedding request rate. Unset means "use the selected provider's known
  // free-tier limit" (voyage 3, gemini 100, jina 60) - resolved in
  // src/embeddings/index.ts, since the right default depends on the provider.
  EMBEDDING_RATE_LIMIT_RPM: optionalCount(),
  EMBEDDING_RATE_LIMIT_BURST: optionalCount(),
  // Tokens/minute - the actual binding constraint on Voyage's free tier
  // (10K/min), where a request count well inside 3 RPM can still 429.
  EMBEDDING_RATE_LIMIT_TPM: optionalCount(),

  ANTHROPIC_RATE_LIMIT_RPM: countWithDefault(50),
  ANTHROPIC_RATE_LIMIT_BURST: optionalCount(),

  // Outbound Gemini LLM request rate. Unset uses Google's free-tier limit
  // for gemini-2.5-flash (10 RPM). Raise it on a paid key.
  GEMINI_RATE_LIMIT_RPM: optionalCount(),

  // Per-IP HTTP limits. /api/ask is 1 query-analysis call + 1-2 generation
  // calls, so it is the expensive endpoint; /api/upload enqueues a job that
  // costs a full ingestion pipeline.
  ASK_RATE_LIMIT_RPM: countWithDefault(10),
  ASK_RATE_LIMIT_BURST: optionalCount(),
  UPLOAD_RATE_LIMIT_RPM: countWithDefault(6),
  UPLOAD_RATE_LIMIT_BURST: optionalCount(),

  // Comma-separated list of allowed frontend origins. Unset reflects
  // whatever origin made the request (fine for a local single-reviewer
  // app with no auth/cookies); set explicitly for anything more exposed.
  CORS_ORIGIN: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }

  const data = parsed.data;
  if (data.LLM_PROVIDER === "gemini" && !data.GEMINI_API_KEY) {
    console.error("Invalid environment configuration:\n  - GEMINI_API_KEY: Required when LLM_PROVIDER=gemini");
    process.exit(1);
  }
  if (data.LLM_PROVIDER === "anthropic" && !data.ANTHROPIC_API_KEY) {
    console.error("Invalid environment configuration:\n  - ANTHROPIC_API_KEY: Required when LLM_PROVIDER=anthropic");
    process.exit(1);
  }

  return data;
}

export const env = loadEnv();
