/**
 * Every layer reads its target from the environment so nothing hardcodes a
 * URL. Defaults match `docker compose up` / `bun run dev` on this machine.
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export const BASE_URL = stripTrailingSlash(
  process.env.API_BASE_URL ?? process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? "3001"}`,
);

/** e2e makes real, billable Anthropic calls - opt in explicitly. */
export const RUN_E2E = process.env.RUN_E2E === "1" || process.env.RUN_E2E === "true";

/** Health/sources probe - short, this is just "is anything there". */
export const PROBE_TIMEOUT_MS = Number(process.env.TEST_PROBE_TIMEOUT_MS ?? 5_000);

/** Retrieval debug: one low-effort analysis call + embedding + FTS. */
export const RETRIEVAL_TIMEOUT_MS = Number(process.env.TEST_RETRIEVAL_TIMEOUT_MS ?? 60_000);

/** /api/ask worst case is analysis + 2 generations (see plan/08-api-contract.md). */
export const ASK_TIMEOUT_MS = Number(process.env.TEST_ASK_TIMEOUT_MS ?? 180_000);

/** How long to wait for an uploaded file to reach a terminal job state. */
export const INGEST_TIMEOUT_MS = Number(process.env.TEST_INGEST_TIMEOUT_MS ?? 180_000);
