# 00 — Architecture & Decision Record

## The system in one paragraph

A TypeScript/Bun backend that ingests case-management transcripts and policy documents into a dual store (Postgres for metadata + keyword search, Qdrant for vectors), then answers open-ended questions by routing each query through a strategy chosen from the question's *shape* — retrieving a bounded, query-dependent candidate set via hybrid search, and generating a cited answer with Claude. Slow ingestion work runs on a separate worker process behind a Redis-backed queue so the API stays responsive and uploads report live progress.

---

## Process topology

Six compose services, one shared image for the three app processes:

```
┌──────────┐   ┌──────────┐   ┌──────────┐
│ postgres │   │  qdrant  │   │  redis   │
└────┬─────┘   └────┬─────┘   └────┬─────┘
     │              │              │
     └──────┬───────┴──────────────┘
            │
      ┌─────┴──────┐  (one-shot, exits)
      │  migrate   │  prisma migrate deploy + ensureQdrantCollection()
      └─────┬──────┘
            │ service_completed_successfully
     ┌──────┴───────┐
     │              │
┌────┴────┐   ┌─────┴─────┐
│   api   │   │  worker   │
│ express │   │  BullMQ   │
└─────────┘   └───────────┘
```

`api` and `worker` are the **same image, different CMD**. This matters: it means one dependency tree, one build, no code duplication, and the worker can import the exact same ingestion functions the API would have called inline.

### Why a separate migrate service

If `api` and `worker` both boot and both run `prisma migrate deploy`, they race on the migration lock. A one-shot service both depend on via `condition: service_completed_successfully` removes the race entirely and gives a clean place to also run the idempotent `ensureQdrantCollection()`.

---

## The async model (this is the core change from the earlier synchronous plan)

### Problem 1 — blocking startup

The earlier plan ran full ingestion in the container entrypoint *before* the server listened. For the bundled dataset that's ~23 Claude calls plus embedding batches: minutes of a blank page for the reviewer, and **any single failed API call means the server never starts at all**. Unacceptable for a `docker compose up` demo.

**Fix:** the API listens immediately. On boot it *enqueues* bootstrap ingestion jobs for the bundled dataset and returns to serving. `GET /api/health` reports `ingestion: {state, pending, ready, failed}` so the frontend can show a "still indexing…" banner instead of a broken empty state.

### Problem 2 — upload is the worst possible synchronous request

The reviewer was told to upload their own files. A synchronous upload does: PDF extract → classify (LLM) → speaker-label (LLM, slow on a 2,700-word transcript) → chunk → embed → dual-store write. That's 30–90s of an open HTTP connection with zero feedback, and it's exactly the path most likely to be exercised during grading.

**Fix:** `POST /api/upload` validates, hashes, enqueues, and returns `202 {jobId}` in milliseconds. Progress is observable two ways:
- `GET /api/jobs/:id` — poll, returns `{state, stage, progress, result?, error?}`
- `GET /api/jobs/:id/events` — SSE stream of stage transitions (`extracting → classifying → labeling → chunking → embedding → storing → ready`)

This turns the riskiest endpoint into the most legible one. The reviewer *watches* their file get classified and chunked.

### Problem 3 — partial failure leaves a corrupt index

A job that dies after writing 30 of 50 chunks leaves a source that looks ingested but isn't. Retrieval would then answer from a half-indexed document without anyone knowing.

**Fix:** `Source.status` lifecycle — `pending → processing → ready | failed`. **Retrieval only ever reads chunks whose source is `ready`.** Write order is: Postgres chunks → Qdrant points → flip status to `ready`. Because chunk ids are deterministic and Qdrant point id == chunk id, a retry re-upserts idempotently rather than duplicating. Postgres and Qdrant can't share a transaction, so this ordering plus the status gate *is* the consistency mechanism — it's the honest way to do it without distributed transactions.

### What stays synchronous

The `/api/ask` path. A user waiting for an answer is a request/response interaction by nature; pushing it through a queue would add latency and complexity for nothing. It's 1 query-analysis call + retrieval + 1–2 generation calls, ~5–15s.

---

## Queue design

**BullMQ on Redis.** One queue, `ingest`. One job per file.

- **`jobId = contentHash`** — dedup falls out for free. Upload the same file twice, BullMQ rejects the duplicate, and we return the existing source.
- **Stages reported via `job.updateProgress({stage, pct})`** — the API relays these to SSE clients through BullMQ's `QueueEvents`, which is already a Redis pub/sub bridge. No custom pub/sub code.
- **Retries:** 3 attempts, exponential backoff, for transient failures (429s, 5xx, network). Deterministic failures (corrupt PDF, unsupported type, zero extractable text) throw `UnrecoverableError` to fail fast instead of burning three attempts on something that will never succeed.
- **Worker concurrency:** configurable, default 2–3. Bounded by external API rate limits, not CPU.

Job granularity is deliberately **one job per file, not a fan-out per stage**. At this corpus size a parent/child DAG buys nothing and costs real complexity. Parallelism inside a job (embedding batches) is handled with bounded concurrency, not more jobs.

---

## What Redis buys beyond the queue

1. **Embedding cache** — `emb:{model}:{sha256(text)}` → vector. Re-ingesting an edited document only pays for changed chunks. Meaningful during development iteration, where the same text gets embedded repeatedly.
2. **Query-analysis cache** — short TTL, keyed on question + conversation context hash.
3. **Rate limiting** — token bucket for Anthropic and Voyage, shared across worker concurrency so parallel jobs don't collectively blow the limit.

Answer caching is deliberately **not** included: an instantly-cached answer during a live demo could mask a retrieval regression, and hiding retrieval behavior is the opposite of what's being graded.

---

## Decision record

### Adopted

| Decision | Rationale |
|---|---|
| Bun + TypeScript + Express | User's stack requirement. |
| Hand-rolled retrieval, no LangChain/LangGraph | The routing logic *is* the deliverable being graded; a framework would hide it. |
| Postgres (Prisma) + Qdrant, joined on chunk id | Prisma owns relational metadata and FTS; Qdrant owns vectors. Avoids pgvector/Prisma custom-type friction. |
| Redis + BullMQ for ingestion jobs | Right-sized durable queue for slow, retryable, API-bound work. Standard in the Node ecosystem. |
| Separate `api` / `worker` processes, one image | API responsiveness without code duplication. |
| `Source.status` gate on retrieval | The only sound way to keep two non-transactional stores consistent. |
| `pdftotext -layout` via poppler | Validated against all 10 real files; the chunking regexes were written against its exact output. |
| Claude `claude-opus-5` for all LLM calls | User requirement. 1M context, adaptive thinking. |
| `client.messages.parse()` + `zodOutputFormat` for every structured call | Schema-validated output. **Assistant prefill returns 400 on Opus 5** — the old "prefill a `{`" trick is dead; this is the supported mechanism. |
| Voyage AI for embeddings, behind a one-file interface | Anthropic's recommended embedding partner. Swappable in one file. |
| Relevance filtering folded into the generation call | Avoids a redundant round trip; corpus is small enough that a dedicated reranker earns nothing. |
| Bounded single retry on `sufficientEvidence: false` | Recovers from a bad first retrieval without unbounded agentic looping. |

### Rejected

| Rejected | Why |
|---|---|
| **Kafka** | Wrong tool. Kafka is for high-throughput streaming, multi-consumer fan-out, and replayable event logs. We have ~10 files, one queue, one consumer. Adding brokers and topics here would be complexity with no corresponding benefit — and to a reviewer it reads as over-engineering, not sophistication. Revisit only if multiple independent services ever need to consume the same ingestion events. |
| **Training a reranker** | Multi-day ML task. Never viable, and unnecessary at this candidate-set size. |
| **A dedicated rerank API (Cohere/Voyage rerank)** | Earns its keep when ordering hundreds of candidates; we order ~15. Extra key, extra call, extra failure mode. |
| **Token-by-token answer streaming** | Genuinely conflicts with the retry loop: you cannot un-stream an answer you've already decided was insufficient. We stream *stage* events instead. Documented as an available tradeoff, not a missing feature. |
| **Postgres-backed job queue (`SKIP LOCKED`)** | A legitimate alternative that avoids the Redis container. Rejected because Redis also gives us caching and rate limiting, and BullMQ's progress/events/retry machinery would otherwise be hand-rolled. |
| **Microservice split beyond api/worker** | No independent scaling or deployment need. |
| **Answer caching** | Could mask retrieval problems during evaluation. |

---

## Two corrections the `claude-api` skill forced (both were wrong in the pre-skill plan)

1. **The 80%-of-context compression trigger was nearly meaningless.** Opus 5 has a **1M token context window**; 80% of that is 800K tokens. A case-management conversation would never approach it, so the feature as specified would be dead code that never runs. Redefined in [07](07-conversation.md) to compress against a *configurable working budget* (default ~120K) rather than the model ceiling — which makes it both meaningful and actually testable.

2. **Refusal handling is a real risk in this specific domain, not boilerplate.** The corpus is criminal-justice content: drug screens, criminal history, offender risk assessment, trauma programming. Safety classifiers can decline such requests, returning HTTP 200 with `stop_reason: "refusal"` — so code that reads `response.content` without checking `stop_reason` first will silently produce garbage. Handled in [09](09-hardening.md), including opting into server-side `fallbacks`.

---

## Scaling notes (for the README's "what I'd do next")

Worth *documenting* rather than building — it demonstrates the production thinking the brief rewards, without spending time on capacity we don't need:

- **Many clients:** already handled — Qdrant payload filters on `clientId`, and broad-theme queries read summary chunks rather than "all chunks for this client."
- **Many documents per client:** summaries become hierarchical (per-session → per-client → per-caseload).
- **Throughput:** scale `worker` replicas horizontally; Redis already coordinates them.
- **When Kafka would actually earn its place:** if ingestion events needed to feed several independent consumers (search index, analytics, audit pipeline) with replay.
- **Evaluation harness:** a golden-question set with expected source documents, scored on retrieval precision/recall — the single highest-value next investment for a RAG system, and the honest answer to "how do you know it's good?"
