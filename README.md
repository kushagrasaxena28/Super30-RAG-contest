# Case Intelligence

A RAG system for community-corrections case managers. You upload client transcripts and policy documents, and then ask open-ended questions across them — "did the case manager follow all of the check-in guidelines in the last meeting?", "what are Robert's biggest risks and needs?", "when should a client submit a grievance?" Every answer is generated only from retrieved evidence, cites the specific chunks it used, and says so explicitly when the evidence isn't there. It runs as a single-page chat app with follow-up questions, live ingestion progress, and an inspectable retrieval endpoint so you can see exactly which chunks a question pulled and why.

Everything runs locally with `docker compose up` and one free API key.

---

## Quick start

You need Docker and a Google AI Studio API key. The key is free, takes about 30 seconds to create, and needs no payment method.

```bash
git clone <repo-url> && cd <repo>
cp .env.example .env
```

Get a key at **https://aistudio.google.com/apikey** (sign in with a Google account → "Create API key"), then put it in `.env`:

```bash
GEMINI_API_KEY=your-key-here
```

That single key powers both the LLM calls and the embeddings. Nothing else in `.env` needs changing — every other value has a working default for Docker.

```bash
docker compose up --build
```

Then open **http://localhost:3000**.

| Service | URL |
|---|---|
| Frontend (single-page app) | http://localhost:3000 |
| Backend API | http://localhost:3001 |

### The app starts with an empty index — that's intentional

By default (`BOOTSTRAP_DATASET=false`) nothing is indexed on boot. The intended flow is that you add the corpus yourself and watch it get processed:

1. **Open http://localhost:3000.** The left sidebar has a **Sources** panel with a "Drop a file or click to upload" target.
2. **Drag in the bundled dataset.** It ships in this repo:
   - `docs/transcriptions_for_test/` — 5 transcripts (Nathan ×3, Robert ×2)
   - `docs/docs_for_test/` — 5 reference documents (Colorado standards, 8 principles of effective intervention, check-in guidelines, grievance & appeal policy, internal programming)

   Drop them in — multiple files at a time is fine. Accepted types: `.pdf`, `.docx`, `.txt`, `.md`.
3. **Watch each file get processed.** Every upload returns immediately with a job id and then streams its stage live in the sidebar: `extracting → classifying → labeling/chunking → embedding → storing → summarizing → ready`. This is where you can see the system decide, per file, that something is a transcript versus a reference document and pick a chunking strategy for it.
4. **Ask questions** in the chat box once files reach `ready`. You don't have to wait for all ten — retrieval reads whatever is `ready` and ignores the rest.

**Expect ingestion of the full 10-file corpus to take a few minutes.** This is the free tier working as designed, not a hang. The Gemini free tier for `gemini-2.5-flash` is 10 requests/minute, and ingestion is LLM-heavy (classification + transcript speaker labeling + segmentation + per-source summarization). The system paces itself against that limit with a Redis token bucket rather than flooding the provider and collecting 429s. Progress is visible the whole time. If your key has higher limits, raise `GEMINI_RATE_LIMIT_RPM` in `.env` and it goes proportionally faster.

**Prefer it pre-loaded?** Set `BOOTSTRAP_DATASET=true` in `.env` before `docker compose up`. The API then enqueues the bundled dataset in `docs/` on boot and comes up populating itself in the background — the API still serves immediately, and `GET /api/health` reports `ingestion: {pending, processing, ready, failed}` so the UI shows an indexing banner rather than a broken empty state.

---

## How to use it

**Uploading.** Drop files onto the Sources panel, or `POST /api/upload`. Files are deduplicated by SHA-256 content hash, so re-uploading the same file costs nothing. File type is sniffed by magic bytes, not trusted from the extension. A scanned/image-only PDF that extracts to fewer than 50 words is rejected with a clear error rather than silently ingested as an empty source.

**Asking.** Type a question and send. The answer arrives with a set of source cards underneath it — each one names the document (or client + session date), the section or standard code where relevant, and an excerpt of the exact chunk that was used. The empty state offers a few example questions to click.

**Following up.** Replies stay in the same conversation, and follow-ups resolve against it. "What about his employment?" after a question about Nathan becomes a standalone query — "what is Nathan's employment situation?" — before it ever reaches retrieval. Conversations are listed in the sidebar and can be reopened.

**Viewing sources.** The Sources panel lists everything indexed: filename, detected type, client, session date, chunk count, status, and a flag if transcript speaker labeling looked unreliable. Sources can be deleted, which removes their chunks from both Postgres and Qdrant.

**When there isn't evidence.** The answer says so, and `sufficientEvidence: false` comes back on the API response. Ask "what is Robert's blood type?" and it will tell you it doesn't have that, rather than inventing something plausible.

---

## RAG architecture

### Stack

| Layer | Choice |
|---|---|
| Backend | Bun + TypeScript + Express (`api` process) |
| Worker | Same image, different command (`worker` process) |
| Frontend | React + Vite, single page |
| Metadata + keyword search | Postgres via Prisma, `tsvector` full-text index |
| Vectors | Qdrant |
| Queue, cache, rate limiting | Redis + BullMQ |
| LLM | Gemini `gemini-2.5-flash` (default) or Anthropic Claude |
| Embeddings | Gemini (default), Voyage, or Jina — behind a one-file interface |

**No LangChain, no LangGraph.** The routing and fusion logic is the thing being evaluated; a framework would hide it behind abstractions. Retrieval here is hand-rolled and readable end to end.

### Request flow

```mermaid
flowchart TD
    U[Upload file] -->|202 + jobId| Q[(Redis / BullMQ)]
    Q --> W[worker process]
    W --> EX[extract text<br/>pdftotext -layout / mammoth / raw]
    EX --> CL[LLM classify<br/>transcript vs reference_document]
    CL --> RT{chunker router}
    RT -->|transcript| TT[LLM speaker labeling<br/>+ turn windows]
    RT -->|reference doc| CH[wholeDoc / standardsRegex<br/>namedSections / llmSegment]
    TT --> EMB[embed chunks]
    CH --> EMB
    EMB --> ST[Postgres chunks -> Qdrant points<br/>-> status = ready]

    QN[Question] --> QA[LLM query analysis<br/>type, entity, temporal, sub-queries, rewrite]
    QA --> RES[resolve client in DB<br/>resolve 'last' via MAX session_date]
    RES --> HS[hybrid search per sub-query<br/>Qdrant dense + Postgres FTS]
    HS --> RRF[Reciprocal Rank Fusion<br/>dedupe -> top 15]
    RRF --> GEN[one LLM call:<br/>filter + synthesize + cite chunk ids]
    GEN --> ANS[answer + resolved sources<br/>+ sufficientEvidence]
    ST -.only 'ready' sources are searchable.-> HS
```

### Ingestion: chunking follows document structure, not a fixed splitter

A single recursive character splitter would have been the fast path and it would have been wrong for this corpus. The five reference documents have three genuinely different native shapes, and the questions in the brief turn on respecting them.

The router (`src/ingestion/strategySelect.ts`, `router.ts`) makes a structural decision first and only falls back to an LLM when nothing structural matches:

| Order | Condition | Chunker | Applies to |
|---|---|---|---|
| 1 | word count < 400 | `wholeDoc` — no split at all | `check-in-guidelines.pdf` (213w), `8 Principles of Effective Intervention.pdf` (281w) |
| 2 | ≥3 matches of `/^[A-Z]{2,4}-\d{3}:/m` | `standardsRegex` — one chunk per standard code | 2022 Colorado Community Corrections Standards (18k words, 63pp) |
| 3 | ≥3 heading-shaped lines | `namedSections` — header prepended to each chunk | `grievance-and-appeal.pdf` |
| 4 | otherwise | `llmSegment` — LLM returns `{title, body}[]` | `internal-programming.pdf` |

Why each matters:

- **The two short documents are never split.** "Did the case manager follow *all* of the check-in guidelines?" requires all 11 numbered items to be in scope together. Chunking that document into three pieces and retrieving one of them produces a confidently wrong answer. Below 400 words, splitting only destroys information.
- **The Colorado standards carry their own citable identifier scheme** (`CD-080: Enhance Intrinsic Motivation`). Splitting on those codes gives chunks that are semantically self-contained *and* directly citable, with a category breadcrumb prepended so a chunk retrieved alone still says what it belongs to. This chunker also strips the repeated page furniture that `pdftotext` interleaves mid-section at page breaks — left in, that boilerplate lands inside chunk bodies and pollutes both the embeddings and the full-text index.
- **`llmSegment` is guarded**: if it returns 0 or 1 segments, or drops more than 20% of the source text, the router falls back to `wholeDoc` rather than trusting a bad segmentation.

Heading detection is deliberately generic (short standalone line, no terminal punctuation, followed by body content) because it has to work on documents you upload, not just the five bundled ones.

### Ingestion: transcripts arrive as raw unlabeled ASR

The transcripts have no speaker tags. They are run-on ASR text with inconsistent casing, sometimes cleanly alternating and sometimes merged. Chunking that as-is would make every "what did the case manager do?" question unanswerable, because there'd be nothing in the text distinguishing case manager from client.

So transcripts get a dedicated LLM preprocessing pass that re-segments them into `{speaker: "case_manager" | "client", text}` turns before chunking. The prompt is given the actual discriminating cue in this data: the case manager works through a check-in script (address, phone, employment, drug screen, ankle monitor, medications, fees, police contact, next appointment) in short confirmatory questions, while the client answers in longer narrative. Chunks are then windows of ~8 turns with ~2 turns of overlap, each carrying `clientId`, `sessionDate`, and `turnRange`.

This is the highest-risk step in the system, so it has four guardrails:

1. **Raw text is always retained** in `Source.rawText`. The labeled version is derived, never a replacement — a bad pass is recoverable and auditable.
2. **Balance check** — if more than 90% of turns land on one speaker, the source is flagged `labelingSuspect: true` and it's surfaced in the Sources panel. It still ingests: degraded is better than absent.
3. **Coverage check** — concatenated turn text must be within ~15% of the source word count. A large shortfall means the model summarized instead of segmenting, which is a silent and dangerous failure mode.
4. **Every derived chunk is marked `speakerSource: "inferred"`**, and the generation prompt is instructed to hedge attribution claims accordingly. These labels are not presented as ground truth.

### Ingestion: classification is by content, not filename

Every file — bundled or uploaded — gets one LLM call over its first ~2,000 words returning `{sourceType, confidence, reasoning}`. Folder placement and filename are hints, never the decision. A policy document uploaded as `nathan-transcript.pdf` still classifies as a reference document and still chunks correctly. This is what protects the upload path from your own file naming.

### Retrieval: query-routed hybrid search

Every question goes through a query-analysis call (`src/retrieval/queryAnalysis.ts`) that returns:

```ts
{
  queryType: "factoid" | "broad_theme" | "multi_hop" | "comparison",
  clientName: string | null,
  temporalRef: "last" | "first" | "all" | null,
  subQueries: string[],
  rewrittenQuery: string
}
```

Two inputs make this work: the **list of client names that actually exist in the database** (so entity extraction matches reality instead of hallucinating a client), and **recent conversation turns** (so "his last session" resolves).

Then:

- **Entity resolution hits the database.** `clientName` is matched case-insensitively against the `Client` table; `clientId` becomes a Qdrant payload filter and a SQL predicate.
- **"Last meeting" is resolved in SQL, not by similarity.** `temporalRef: "last"` becomes `MAX(session_date) WHERE clientId = ?`. Asking a vector index which transcript is the most recent is the wrong instrument; the database knows exactly.
- **Dense and sparse run in parallel and are fused by Reciprocal Rank Fusion** (`score = Σ 1/(k + rank)`, k=60). Dense is Qdrant with a query-kind embedding and server-side payload filters; sparse is Postgres `ts_rank` over a generated `tsvector` column. RRF rather than score normalization because cosine similarity and `ts_rank` live on incomparable scales — rank-based fusion sidesteps calibration entirely.
- **The sparse half is not optional.** The standards document is full of citable codes (`CD-080`, `CS-060`) and proper nouns ("ankle monitor", "grievance") that dense retrieval blurs. "What is CD-080?" is answered by the keyword half.

Strategies per question shape:

| Type | Approach |
|---|---|
| `factoid` | Hybrid, k≈8, entity filter when resolved, summary chunks excluded — you want specifics. |
| `broad_theme` | Per-source summary chunks for the entity first (generated at ingestion time), plus bounded top-k detail chunks for quotable specifics. Never "all chunks for this client" — that's exactly what breaks at 100 clients. |
| `multi_hop` | Retrieve per sub-query in parallel, union, dedupe by chunk id, keep best fused rank. |
| `comparison` | Multi-hop with one sub-query per compared item, forcing representation from each so one side can't dominate the candidate set. |

**Cross-origin retrieval isn't a separate strategy** — it's the *absence* of a `sourceType` filter, which is the default everywhere.

#### The worked example

> *"Did the case manager use the 2nd principle of effective intervention in Nathan's last meeting?"*

This question is hard for a naive RAG pipeline in a specific way: the transcript that answers it shares almost no vocabulary with the question. Nobody in that meeting said "principle of effective intervention." A single embedding of the question retrieves the principles document five times over and never touches the transcript.

Here the query analyzer classifies it `multi_hop`, extracts `clientName: "Nathan"`, `temporalRef: "last"`, and decomposes into sub-queries — roughly "what is the 2nd principle of effective intervention" and "what did the case manager do in Nathan's most recent session." The temporal reference resolves in SQL to Nathan's actual latest `session_date` (`nathan-06-02`), which becomes a filter. Two retrievals run, one landing on the policy document and one on that specific transcript, and the union is what reaches the generator — two source types, both required, neither reachable by the other's query.

#### The candidate set is always bounded

Whatever the strategy, however wide the search went, the union is sorted by fused score and truncated to **15 chunks** (`RETRIEVAL_CANDIDATE_LIMIT`) before generation. Token cost per question is bounded and roughly constant. This is the concrete, checkable answer to the brief's "do NOT send all documents and transcripts to the LLM for every question."

You can see all of this per-question without spending a generation call:

```bash
curl -X POST localhost:3001/api/debug/retrieval -H 'content-type: application/json' \
  -d '{"question":"Did the case manager use the 2nd principle of effective intervention in Nathan'\''s last meeting?"}'
```

It returns the query analysis, the resolved client id and session date, and every candidate with its dense rank, sparse rank, fused score, metadata and excerpt.

### Generation: filter, synthesize and cite in one call

There is no separate reranking step. The prompt supplies the ~15 candidates and instructs the model that some are irrelevant, that it should decide which, answer only from those, and cite only what it actually used. Filtering, synthesis and citation happen in one structured call returning:

```ts
{
  answer: string,
  citedChunkIds: string[],
  sufficientEvidence: boolean,
  assumptions: string[]
}
```

A dedicated rerank model earns its keep when ordering hundreds of candidates. Ordering 15 with an extra API call, an extra key and an extra failure mode buys nothing here, and folding relevance judgment into the call that already has to read all 15 chunks costs one round trip less.

**Citations are chunk ids, never free text.** The model picks ids from the list it was given; `src/generation/citations.ts` then resolves those ids into display sources — label, source type, client, session date, section, standard code, excerpt — entirely from database rows. Ids not in the supplied candidate set are dropped and logged. This makes a fabricated citation structurally impossible: "Robert Transcript 2 (2025-05-21)" is assembled by the server from a `Source` row, never written by the model.

**`sufficientEvidence: false` is a first-class outcome.** If it comes back false on the first pass, retrieval widens exactly once (entity filter dropped, k raised, summaries included) and generation runs again — a maximum of two generation calls, a bounded widening rather than agentic looping. If it's still insufficient, the flag is returned to the client and the UI shows it. `assumptions[]` surfaces ambiguity instead of hiding it: ask "did the case manager follow the check-in guidelines?" with no client named, and the answer states which session it used.

The grounding rules in the system prompt also require the model to distinguish what the *client said* from what the *case manager did* (many of the brief's questions turn precisely on that), to treat inferred speaker labels as inferred, and to ground inference in cited evidence rather than refuse to infer — "what are his biggest risks and needs?" is a legitimately inferential question and answering it with a refusal would be useless.

Retrieved content is wrapped in `<evidence>` / `<reference_document>` tags with an explicit instruction that it is data to analyze and never instructions to follow, regardless of what it claims.

### Async architecture: ingestion never blocks the API

A synchronous upload would be: PDF extract → classify (LLM) → speaker-label (LLM, slow) → chunk → embed → dual-store write. That's 30–90 seconds of an open HTTP connection with zero feedback, on the exact path a reviewer will exercise most.

Instead, `POST /api/upload` validates, hashes, enqueues and returns `202 {jobId}` in milliseconds. BullMQ on Redis processes the job in a separate `worker` process — the same image as `api`, different command, so there's one dependency tree and the worker imports the exact same ingestion functions.

- **`jobId = contentHash`**, so deduplication falls out for free at the queue level as well as the database level.
- **Progress** is reported via `job.updateProgress({stage, pct})` and relayed to clients two ways: poll `GET /api/jobs/:id`, or stream `GET /api/jobs/:id/events` (SSE, with current state sent immediately on connect so a late subscriber still gets a terminal event, plus a heartbeat).
- **Retries**: 3 attempts with exponential backoff for transient failures (429s, 5xx, network). Deterministic failures — corrupt PDF, unsupported type, no extractable text — throw an unrecoverable error and fail fast instead of burning three attempts.
- **Rate limiting is a Redis token bucket, not in-process.** The worker runs `WORKER_CONCURRENCY` jobs in parallel and the API embeds queries in a *different process*; a per-process limiter would count a fraction of the traffic and the processes would collectively blow the provider limit while each believed it was under it.

**Consistency between two non-transactional stores** is handled by a `Source.status` lifecycle: `pending → processing → ready | failed`. Write order is Postgres chunks → Qdrant points → flip to `ready`, and **retrieval only ever reads chunks whose source is `ready`**. A job that dies after writing 30 of 50 chunks leaves a source that is never queryable rather than one that silently answers from half a document. Chunk ids are deterministic and the Qdrant point id equals the chunk id, so a retry re-upserts idempotently instead of duplicating.

A one-shot `migrate` service runs `prisma migrate deploy` plus an idempotent Qdrant collection check and exits; `api` and `worker` both wait on `service_completed_successfully` rather than racing each other for the migration lock.

`POST /api/ask` stays synchronous. A user waiting for an answer is a request/response interaction by nature; pushing it through a queue would add latency for nothing.

### Multi-turn conversations

Conversations and messages are persisted in Postgres. Three pieces make follow-ups work:

1. **Query rewriting.** The query-analysis call sees recent turns and returns `rewrittenQuery` — a standalone version of the question. Retrieval never sees the raw pronoun-laden follow-up. The prompt also instructs the analyzer *not* to carry a client over when the current question isn't actually about them ("when should anyone file a grievance?" is general even mid-thread about Nathan).
2. **History in the generation prompt**, positioned between the stable instructions and the volatile candidate block.
3. **Compression past a budget.** When approximate history tokens exceed 80% of `CONVERSATION_TOKEN_BUDGET` (default 120,000), older turns are summarized while the most recent turns stay verbatim. Compression is repeatable — a second pass merges with the existing summary rather than replacing it — and summarized messages stay in Postgres, excluded only from generation context, still fully visible via `GET /api/conversations/:id`. The budget is deliberately a *working* budget rather than "80% of the model's context window", which on a large-context model would be dead code that never runs.

---

## API reference

Base URL `http://localhost:3001`.

### `POST /api/ask`

```bash
curl -X POST localhost:3001/api/ask -H 'content-type: application/json' \
  -d '{"question":"When should a client submit a grievance?"}'
```

Body: `{ question: string, conversationId?: uuid }`. Pass the returned `conversationId` on the next call to continue the thread.

```jsonc
{
  "conversationId": "…",
  "messageId": "…",
  "answer": "A client should file a grievance within …",
  "sources": [
    {
      "chunkId": "…",
      "label": "grievance-and-appeal.pdf — Timeline for Filing a Grievance",
      "sourceType": "reference_document",
      "section": "Timeline for Filing a Grievance",
      "excerpt": "…",
      "isSummary": false
    }
  ],
  "sufficientEvidence": true,
  "assumptions": [],
  "timings": { "analysisMs": 900, "retrievalMs": 210, "generationMs": 6400 }
}
```

Transcript sources additionally carry `clientName` and `sessionDate`; standards chunks carry `standardCode`.

### `POST /api/upload`

`multipart/form-data`, field name `file`. Accepts `.pdf`, `.docx`, `.txt`, `.md`, up to 25 MB.

```bash
curl -X POST localhost:3001/api/upload -F file=@docs/transcriptions_for_test/nathan-06-02.pdf
# 202 { "jobId": "<sha256>", "status": "queued", "deduplicated": false }
```

Returns `202` immediately. `deduplicated: true` (with `sourceId`) means this exact content is already indexed. `413` if too large, `415` if the type is unsupported or the extension disagrees with the magic bytes.

### `GET /api/jobs/:id` and `GET /api/jobs/:id/events`

```bash
curl localhost:3001/api/jobs/<jobId>
# { "jobId": "…", "state": "active", "stage": "labeling", "progress": 0.3 }

curl -N localhost:3001/api/jobs/<jobId>/events   # SSE stream of the same shape
```

`state` is `queued | active | completed | failed`. `stage` moves through `extracting → classifying → labeling|chunking → embedding → storing → summarizing → ready`.

### `GET /api/sources` and `DELETE /api/sources/:id`

```bash
curl localhost:3001/api/sources
```

```jsonc
{
  "sources": [
    {
      "id": "…",
      "filename": "nathan-06-02.pdf",
      "sourceType": "transcript",
      "status": "ready",
      "clientName": "Nathan",
      "sessionDate": "2025-06-02",
      "chunkCount": 7,
      "labelingSuspect": false,
      "createdAt": "…"
    }
  ]
}
```

`DELETE /api/sources/:id` → `204`, removing the source's chunks from Postgres and Qdrant.

### `GET /api/conversations` and `GET /api/conversations/:id`

List threads (id, createdAt, preview) or load one with its full message history including per-message sources.

### `GET /api/health`

```bash
curl localhost:3001/api/health
# { "status":"ok", "postgres":true, "qdrant":true, "redis":true,
#   "ingestion": { "pending":0, "processing":1, "ready":9, "failed":0 } }
```

`200` when all three stores are reachable, `503` otherwise.

### `POST /api/debug/retrieval`

Query analysis plus every candidate with dense rank, sparse rank, fused score, metadata and excerpt — **no generation call**. The fastest way to verify retrieval is real and query-dependent.

```bash
curl -X POST localhost:3001/api/debug/retrieval -H 'content-type: application/json' \
  -d '{"question":"What are the key themes Robert talks about?"}'
```

### Errors

Uniform shape: `{ "error": { "code", "message", "details"? } }`. `POST /api/ask` is limited to 10 req/min per IP and `POST /api/upload` to 6 req/min per IP, both returning `429` with `Retry-After` immediately rather than holding the connection open. A model safety refusal — a real possibility on criminal-justice content — returns `422 model_refusal` rather than an opaque 500.

---

## Project layout

```
apps/backend/
  src/
    api/routes/       ask, upload, jobs, sources, conversations, health, debug
    ingestion/        extract, classify, identity, router, strategySelect, summaries
      chunkers/       wholeDoc, standardsRegex, namedSections, llmSegment, transcriptTurns
    retrieval/        queryAnalysis, clientResolver, temporal, hybridSearch, rrf, orchestrator
      strategies/     factoid, broadTheme, multiHop
    generation/       promptAssembly, answerGenerator, citations, citationFilter, askPipeline
    conversation/     store, window, compress
    embeddings/       provider interface + gemini / voyage / jina
    llm/              provider dispatch (gemini | anthropic) + prompts
    jobs/             BullMQ queue + ingest job
    db/               prisma, qdrant, fts
    ratelimit/        Redis token bucket
    worker/           worker entrypoint
  prisma/schema.prisma
  tests/              unit (chunkers, rrf, citations, extract, identity),
                      integration (retrieval), e2e (ask, upload)
apps/frontend/src/    React single-page chat UI
docs/                 assignment brief + bundled test dataset
docker-compose.yml
```

---

## Configuration

`.env.example` is the authoritative list and carries inline notes; this is the summary.

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | **Required.** Powers LLM *and* embeddings. https://aistudio.google.com/apikey |
| `LLM_PROVIDER` | `gemini` | `gemini` or `anthropic` |
| `GEMINI_MODEL` | `gemini-2.5-flash` | |
| `ANTHROPIC_API_KEY` | unset | Only when `LLM_PROVIDER=anthropic` |
| `EMBEDDING_PROVIDER` | `gemini` | `gemini`, `voyage`, or `jina` |
| `VOYAGE_API_KEY` / `JINA_API_KEY` | unset | Only for those providers |
| `BOOTSTRAP_DATASET` | `false` | `true` auto-ingests `docs/` on boot |
| `DATABASE_URL` | `postgresql://rag:rag@postgres:5432/casedb` | Matches compose |
| `QDRANT_URL` | `http://qdrant:6333` | |
| `QDRANT_COLLECTION` | `case_chunks` | |
| `REDIS_URL` | `redis://redis:6379` | |
| `PORT` | `3001` | |
| `NODE_ENV` | `production` | |
| `CORS_ORIGIN` | unset | Unset reflects the requesting origin — fine locally |
| `INGESTION_DOCS_DIR` | `/data/docs/docs_for_test` | Only used when bootstrapping |
| `INGESTION_TRANSCRIPTS_DIR` | `/data/docs/transcriptions_for_test` | Only used when bootstrapping |
| `UPLOAD_DIR` | `/data/uploads` | |
| `WORKER_CONCURRENCY` | `3` | Bounded by API rate limits, not CPU |
| `CONVERSATION_TOKEN_BUDGET` | `120000` | History budget before older turns are summarized |
| `GEMINI_RATE_LIMIT_RPM` | `10` | Free-tier default; raise if your key allows |
| `EMBEDDING_RATE_LIMIT_RPM` / `_BURST` / `_TPM` | provider default | gemini 60, voyage 3, jina 60 |
| `ANTHROPIC_RATE_LIMIT_RPM` | `50` | Only when `LLM_PROVIDER=anthropic` |
| `ASK_RATE_LIMIT_RPM` | `10` | Per-IP |
| `UPLOAD_RATE_LIMIT_RPM` | `6` | Per-IP |

**Rate limits default to provider free-tier values on purpose.** Setting them too high floods the provider, collects 429s, exhausts the retry budget and fails jobs. Pacing to the real limit is what makes ingestion reliable on a free key.

**Switching embedding providers requires dropping the Qdrant collection and re-ingesting.** All supported models are 1024-dimensional so the collection shape is identical, but vectors from different models are not interchangeable. The collection carries a `{model, dim}` marker and refuses to boot against vectors from a different model rather than silently returning nonsense. To switch: `docker compose down -v` (or delete the collection), change `EMBEDDING_PROVIDER`, bring it back up, re-ingest.

---

## Known limitations

Stated here rather than left to be discovered.

- **Transcript speaker labels are LLM-inferred, not ground truth.** The source data has no speaker tags at all, so there is no way to be certain. A pass that looks unreliable is flagged `labelingSuspect` and surfaced in the UI, but still ingested; raw text is always retained; every derived chunk is marked `inferred`; and the generation prompt hedges attribution accordingly. It is a real source of error on "what exactly did the case manager say" questions.
- **No OCR.** A scanned or image-only PDF extracts to under 50 words and is rejected with an explicit error rather than silently ingested as an empty source that quietly degrades retrieval.
- **Two small reference documents are pinned in the system prompt rather than retrieved.** The check-in guidelines and the 8 principles of effective intervention total roughly 500 words, and they are the evaluative rubric for a large share of the interesting questions ("did the CM follow all the guidelines", "the Nth principle"). They are pinned verbatim in the stable prompt prefix. The selection is generic, not hardcoded to those filenames — any `reference_document` that chunked to a single sub-400-word chunk is pinned, so a small policy document you upload gets the same treatment. Stated plainly so it isn't mistaken for bypassing the retrieval requirement: it is two documents under 500 words; the other ~18,600 words of reference material and every transcript are retrieved per query.
- **Client identity is parsed from the filename first** (`name-MM-DD`, tolerant of the dataset's inconsistent zero-padding in `robert-5-21.pdf`), with a fallback to name/date extracted from transcript content during the labeling pass. Filename-only parsing has no year, so it defaults to 2025 — correct for this dataset, a best-effort guess in general. If neither source yields an identity it is left unset and reported, never invented.
- **No authentication and no multi-tenancy.** This is a single-reviewer local application, not a deployed multi-user service. There is no per-user isolation of sources or conversations.
- **No formal retrieval evaluation harness.** `/api/debug/retrieval` makes retrieval inspectable per question, and there are unit tests for chunkers, RRF, citation filtering, extraction and identity plus integration and e2e tests — but there is no golden-question regression set scoring precision and recall. This is the honest gap between "demonstrably reasoning correctly on the questions I tried" and "measurably good."
- **No dedicated reranker**, by design at this candidate-set size — see the generation section above.
- **Full ingestion of the 10-file corpus takes a few minutes on free-tier limits.** Expected, paced deliberately, and visible in the UI throughout.
- **Answers are not token-streamed.** Stage events stream during ingestion, but the answer arrives whole. This is a direct consequence of the bounded retry: you cannot un-stream an answer you have already decided was built on insufficient evidence. A deliberate tradeoff, not an oversight.

---

## What I'd do next

1. **A retrieval evaluation harness.** A golden-question set — each question paired with the source documents that *must* appear in its candidate set — scored for precision and recall and run in CI against every retrieval change. This is the single highest-value next investment: right now retrieval quality is inspectable but not measurable, and every tuning decision is a judgment call rather than a regression-tested one. It's also the only honest way to answer "did that change make it better?"
2. **Hierarchical summaries as transcripts-per-client grows.** Broad-theme questions currently read per-source summary chunks, which works cleanly at 2–3 sessions per client. At 30 sessions the summary set itself becomes too large to hand over wholesale, and the right structure is a tier: per-session → per-client → per-caseload, with retrieval descending only as far as the question needs.
3. **Horizontal worker scaling.** Ingestion throughput is bounded by provider rate limits today, but the worker is stateless and Redis already coordinates it — with a higher-limit key, `deploy.replicas` on the `worker` service is the only change needed. The rate limiter is already a shared Redis token bucket, so added replicas stay collectively within the limit rather than each blowing it independently.
