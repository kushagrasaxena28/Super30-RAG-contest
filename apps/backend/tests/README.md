# Acceptance-test harness

Automates [plan/10-verification.md](../../../plan/10-verification.md). Three layers,
separated because they have different prerequisites and different costs.

| Layer | Needs | Costs | Command |
|---|---|---|---|
| `unit/` | nothing | free | `bun run test:unit` |
| `integration/` | API + Postgres/Qdrant/Redis + a populated index | one low-effort analysis call + one embedding per question | `bun run test:integration` |
| `e2e/` | all of the above **and** `RUN_E2E=1` | real Anthropic generation calls | `bun run test:e2e` |

`bun run test` runs all three. Layers whose prerequisites are missing skip
rather than fail, so this is safe to run at any time.

Run everything from `apps/backend`.

## What each layer covers

**`unit/`** — pure functions, no network, no database, no env vars. Nothing here
imports `src/config/env.ts` (which `process.exit`s on missing keys), so the layer
runs from a cold clone.

- `rrf.test.ts` — RRF fusion math (`src/retrieval/rrf.ts`): 1-indexed ranks,
  `1/(60+rank)`, and the invariant that a chunk hit by both legs outranks one hit
  by a single leg at the same rank.
- `chunkers.test.ts` — the `CS-010:` code-scheme split, the 213-word check-in
  guidelines staying **one** chunk (plan/11), and the routing decision itself.
- `identity.test.ts` — client + session date from the filename convention.
  Pins `DEFAULT_YEAR = 2025`: `nathan-06-02.pdf` → Nathan, `2025-06-02`.
- `citations.test.ts` — the anti-fabricated-citation guarantee: a chunk id the
  model was not shown, or that has no database row, is **dropped**, never rendered.
- `extract.test.ts` — magic-byte validation: a PNG named `.pdf` is rejected 415.

**`integration/`** — the retrieval table from plan/10, driven through
`POST /api/debug/retrieval`. No generation calls. Asserts the candidate budget
against `RETRIEVAL_CANDIDATE_LIMIT` read from `src/config/constants.ts`, not a
hardcoded number.

**`e2e/`** — the full `POST /api/ask` path: happy path, the blood-type negative
test, the ambiguity test, the three-turn conversation including plan/07's
over-reach guard, and upload deduplication. The upload test creates a throwaway
document and deletes it again in `afterAll`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | `http://localhost:${PORT:-3001}` | where the API is |
| `RUN_E2E` | unset | `1` enables the e2e layer |
| `TEST_PROBE_TIMEOUT_MS` | `5000` | health/sources probe |
| `TEST_RETRIEVAL_TIMEOUT_MS` | `60000` | per debug-retrieval call |
| `TEST_ASK_TIMEOUT_MS` | `180000` | per `/api/ask` call |
| `TEST_INGEST_TIMEOUT_MS` | `180000` | upload → `ready` |

## What a skip means

A skip is **not** a pass and **not** a failure — it means the layer's
prerequisites were not met. The reason is printed once per file before the run:

```
  [skip] integration/retrieval: index is not populated - 0 sources with status
  "ready" (health.ingestion = {...}). Let bootstrap ingestion finish, then re-run.
```

The precondition probe (`helpers/preconditions.ts`) distinguishes:

- **backend not reachable** — nothing is listening at `API_BASE_URL`. Start it
  (`bun run dev`, or `docker compose up` from the repo root), or point
  `API_BASE_URL` elsewhere.
- **a dependency is down** — the API answered but reports Postgres, Qdrant or
  Redis unhealthy.
- **index not populated** — the API is healthy but no source has reached
  `ready`, or the ready sources hold zero chunks. Bootstrap ingestion has not
  finished (or has failed); watch `GET /api/health`.
- **e2e is opt-in** — `RUN_E2E` is unset. This one is the normal, expected
  state; e2e spends real money.

## Known gap

`tests/` is outside the `include` of `apps/backend/tsconfig.json` (which is
`src`-only, with `rootDir: src`), so `tsc --noEmit` does not type-check the
harness. Closing that needs `bun add -d @types/bun` plus a `tests/tsconfig.json`
with `"types": ["bun"]`; it was left out here to avoid a lockfile change. Bun
transpiles and runs the tests either way.
