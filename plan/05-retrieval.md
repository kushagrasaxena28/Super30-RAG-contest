# 05 — Retrieval

**Goal:** the part actually being graded. Given a question (and conversation context), return a small, bounded, well-chosen candidate set — and be able to *show* why.

## Deliverables

```
src/retrieval/queryAnalysis.ts     LLM: entity + type + decomposition
src/retrieval/clientResolver.ts    name → Client row
src/retrieval/hybridSearch.ts      vector + FTS, fused
src/retrieval/strategies/
  factoid.ts  broadTheme.ts  multiHop.ts
src/retrieval/orchestrator.ts      dispatch + dedupe + budget
src/api/routes/debug.ts            POST /api/debug/retrieval
```

## Query analysis

One Claude call (`effort: "low"`, it's a simple structured task) returning:

```ts
{
  queryType: "factoid" | "broad_theme" | "multi_hop" | "comparison",
  clientName: string | null,
  temporalRef: "last" | "first" | "all" | null,
  subQueries: string[],          // decomposition for multi_hop
  rewrittenQuery: string         // context-resolved, standalone
}
```

Two things it must receive to work: **the list of known client names** (so entity extraction matches reality rather than hallucinating) and **recent conversation turns** (so "his last session" resolves).

`rewrittenQuery` is the important output for multi-turn: "what about his family?" becomes "what is Nathan's relationship with his family like?" — a standalone query that retrieval can actually use. Retrieval never sees the raw pronoun-laden follow-up.

**`temporalRef` is resolved in SQL, not by similarity.** "Last meeting" → `MAX(sessionDate) WHERE clientId = ?`. Asking a vector index which transcript is most recent is the wrong tool; the database knows exactly.

## Hybrid search

Dense and sparse in parallel (`Promise.all`), fused with **Reciprocal Rank Fusion**:

```
score(chunk) = Σ 1 / (k + rank_in_list)     k = 60
```

RRF over score-normalization because cosine similarities and `ts_rank` scores live on incomparable scales; rank-based fusion sidesteps calibration entirely.

- **Dense:** Qdrant, `kind: "query"` embedding, payload filters applied server-side (`clientId`, `sourceType`, `isSummary`).
- **Sparse:** Postgres `ts_rank` over the generated `searchVector`, via `$queryRaw`. Catches exact terms embeddings blur — "grievance", "CD-080", proper nouns, "ankle monitor".
- Both filter `Source.status = ready`.

Keyword search is not optional here. The Colorado standards are full of citable codes (`CS-060`, `CD-080`) that a user may quote verbatim; dense retrieval alone handles those poorly.

## Strategies

| Type | Approach |
|---|---|
| **factoid** | Hybrid, k≈8, entity filter if resolved, `isSummary` excluded (want specifics, not summaries). |
| **broad_theme** | Summary chunks for the entity first, plus bounded top-k detail chunks for quotable specifics. Never "all chunks for this client" — that's what breaks at 100 clients. |
| **multi_hop** | Retrieve per sub-query in parallel, union, dedupe by chunk id, keep best fused rank. This is what pulls a doc chunk *and* a transcript chunk for "did the CM use principle 2 in the last meeting" — the transcript chunk shares almost no vocabulary with the question, so only decomposition finds it. |
| **comparison** | Multi-hop with one sub-query per compared item; force representation from each so one side can't dominate the candidate set. |

Cross-origin isn't a separate strategy — it's the *absence* of a `sourceType` filter, which is the default everywhere.

**Final budget: ~15 candidates**, truncated by fused rank, regardless of strategy. Bounded token cost per query no matter how wide the search went — and the concrete answer to the brief's "don't send everything to the LLM."

## The debug endpoint

`POST /api/debug/retrieval` → query analysis output + every candidate with its dense rank, sparse rank, fused score, and source. **No generation.**

Disproportionately valuable: it's how we tune retrieval without burning generation calls, and it's how a reviewer *sees* that retrieval is real and query-dependent rather than taking our word for it. Given "how good your RAG system actually is" is the stated grading criterion, making retrieval inspectable is close to free marks.

## Done when

- "When should a client submit a grievance?" → grievance doc's Timeline section ranks top.
- "What are key themes Robert talks about?" → Robert's summary chunks present, Nathan's absent.
- "Did the CM use the 2nd principle in Nathan's last meeting?" → candidates include **both** the 8-Principles doc **and** chunks from `nathan-06-02` specifically (the real `MAX(sessionDate)`).
- "What is CD-080?" → exact standard chunk retrieved (proves the sparse half is pulling weight).
- A follow-up with a pronoun retrieves the same entity as the prior turn.
- No query ever exceeds ~15 candidates.

## Cut / risk

- Multi-hop decomposition is the first cut → treat as single hybrid search. Real quality loss on the most interesting questions; cut only under genuine time pressure.
- The debug endpoint is nearly free and pays for itself in tuning time. Keep it.
- **Risk:** query analysis adds ~1–2s to every question. Mitigate with the Redis cache and `effort: "low"`. If it becomes the latency bottleneck, a heuristic fast path (no client named + short question → factoid, skip the call) is a reasonable optimization — but measure before adding that branch.
