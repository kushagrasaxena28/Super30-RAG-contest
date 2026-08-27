import { BASE_URL, RUN_E2E } from "./config.js";
import { getHealth, getSources, type HealthPayload, type SourceRow } from "./api.js";

export interface IndexProbe {
  ok: boolean;
  /** Human-readable explanation of why the layer is being skipped. */
  reason: string;
  health?: HealthPayload;
  sources: SourceRow[];
}

/**
 * Integration and e2e need a reachable API *and* a populated index. Detect
 * both up front so those layers skip with an explanation instead of failing
 * with a wall of confusing assertion errors.
 */
export async function probeIndex(): Promise<IndexProbe> {
  let health: HealthPayload;
  try {
    health = await getHealth();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      sources: [],
      reason: `backend not reachable at ${BASE_URL} (${msg}). Start it with \`bun run dev\` in apps/backend (or \`docker compose up\`), or point API_BASE_URL somewhere else.`,
    };
  }

  const down = (["postgres", "qdrant", "redis"] as const).filter((k) => !health[k]);
  if (down.length > 0) {
    return { ok: false, health, sources: [], reason: `backend reports these dependencies down: ${down.join(", ")}.` };
  }

  let sources: SourceRow[];
  try {
    sources = await getSources();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, health, sources: [], reason: `GET /api/sources failed: ${msg}` };
  }

  const ready = sources.filter((s) => s.status === "ready");
  if (ready.length === 0) {
    return {
      ok: false,
      health,
      sources,
      reason: `index is not populated - 0 sources with status "ready" (health.ingestion = ${JSON.stringify(health.ingestion)}). Let bootstrap ingestion finish, then re-run.`,
    };
  }

  const chunks = ready.reduce((n, s) => n + s.chunkCount, 0);
  if (chunks === 0) {
    return {
      ok: false,
      health,
      sources,
      reason: `${ready.length} sources are "ready" but they hold 0 chunks between them - the index is empty.`,
    };
  }

  return { ok: true, health, sources: ready, reason: "" };
}

export interface E2eProbe extends IndexProbe {}

export async function probeE2e(): Promise<E2eProbe> {
  if (!RUN_E2E) {
    return {
      ok: false,
      sources: [],
      reason: "e2e is opt-in because it makes real, billable Anthropic calls. Enable with RUN_E2E=1 (or `bun run test:e2e`).",
    };
  }
  const probe = await probeIndex();
  return probe;
}

/** Printed once per skipped file so the reason is visible in the run output. */
export function announceSkip(layer: string, probe: { ok: boolean; reason: string }): void {
  if (probe.ok) return;
  console.warn(`\n  [skip] ${layer}: ${probe.reason}\n`);
}

export function findSource(sources: SourceRow[], pattern: RegExp): SourceRow | undefined {
  return sources.find((s) => pattern.test(s.filename));
}
