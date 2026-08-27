# 04 — Embeddings & dual-store writes

**Goal:** chunks become searchable in both stores, consistently, idempotently, without re-paying for work already done.

## Deliverables

```
src/embeddings/index.ts     EmbedFn interface + Voyage implementation + EMBEDDING_DIM
src/embeddings/cache.ts     Redis-backed embedding cache
src/storage/writeChunks.ts  transactional-as-possible dual write
src/ingestion/summaries.ts  per-source + per-client summary chunks
```

## The embedding interface

One file, one seam:

```ts
export const EMBEDDING_DIM = 1024;            // must match the model
export type EmbedFn = (
  texts: string[],
  kind: "document" | "query"
) => Promise<number[][]>;
```

The `kind` parameter matters and is easy to miss: Voyage (like most modern embedding models) uses **asymmetric input types** — documents and queries get embedded differently. Passing a query through the document path measurably degrades retrieval. Wire it correctly from the start; it's nearly impossible to notice later.

`EMBEDDING_DIM` must match the Qdrant collection dimension. Mismatch fails at insert with an opaque error — assert it at boot in `ensureCollection()`.

Swapping providers touches this file only. Note that changing models invalidates every stored vector: the collection must be recreated and everything re-embedded. Guard with a `{model, dim}` marker stored in Qdrant collection metadata, checked at boot, refusing to start on a silent mismatch rather than serving nonsense results.

## Batching & concurrency

- Voyage takes arrays — batch ~64 texts per call, respecting the API's token cap per request.
- Bounded concurrency (~2–3 in-flight batches) via a small semaphore. Not `Promise.all` over everything: a 63-page document would fire dozens of parallel requests and hit rate limits immediately.
- Shared Redis token bucket so multiple worker jobs don't collectively exceed limits.

## Embedding cache

`emb:{model}:{sha256(text)}` → vector, in Redis. Meaningful because during development the same chunks get re-embedded on every pipeline iteration; also makes re-ingesting an edited document cheap (only changed chunks pay).

Include the model id in the key — otherwise a model swap silently serves stale vectors of the wrong dimension.

## Dual-store write

Postgres and Qdrant cannot share a transaction. The ordering **is** the correctness argument:

```
1. Postgres: insert Chunk rows (source still `processing`)   ← ids assigned here
2. Qdrant:   upsert points, point.id = chunk.id              ← deterministic, idempotent
3. Postgres: Source.status = ready                           ← the commit point
```

Retrieval filters on `Source.status = ready`, so a crash at any step leaves an invisible partial source rather than a corrupt visible one. A retry re-runs 1–3; step 2 upserts by the same ids and converges. Step 3 is the only moment anything becomes visible.

Cleanup on permanent failure: delete the source's chunks and points, leave `Source` with `status=failed` + error for inspection.

**Qdrant payload** — only what filtering needs: `clientId`, `sourceType`, `isSummary`, `sessionDate`, `sourceId`. Not the chunk text. Two copies of the text in two stores will drift; Postgres is the single source of truth for content, fetched by id after the vector search returns ids.

## Summary chunks

This is what makes "what are the key themes Robert talks about?" work. Plain top-k similarity fails on such questions — no single chunk is "most similar" to a vague thematic query.

- **Per-source summary** — one LLM call per transcript/document at ingest: themes, concerns, notable specifics. Stored as a chunk with `isSummary: true`.
- **Per-client rolling summary** — synthesized across that client's session summaries. **Regenerated when a new session for that client is ingested**, so it stays current as sessions arrive.

Both are embedded and retrievable like any other chunk, just flagged. Broad-theme queries prefer them; factoid queries can exclude them.

This is also the scaling answer: a client with 50 sessions is still 1 rolling summary + 50 session summaries, not 50 × N raw chunks dumped into a prompt.

## Done when

- Chunk count in Postgres == point count in Qdrant, for `ready` sources.
- Re-running ingestion on unchanged files makes **zero** embedding API calls (cache + hash dedup both hit).
- Killing the process between steps 1 and 2 leaves the source not-`ready` and invisible to retrieval; the retry converges cleanly.
- Every transcript has a summary chunk; each client has exactly one current rolling summary.
- Query embeddings use `kind: "query"`, documents use `kind: "document"` (verify by inspection — this is silently wrong otherwise).

## Cut / risk

- Per-client rolling summaries are cuttable (fall back to per-source summaries only); per-source summaries are not — theme questions degrade badly without them.
- Embedding cache is cuttable — pure optimization, zero correctness impact.
- **Confirm Voyage's actual model name, dimension, and batch limits from their live docs during implementation.** Don't hardcode from memory; a wrong dimension is a boot-time failure and a wrong model name is a 400 on first call.
