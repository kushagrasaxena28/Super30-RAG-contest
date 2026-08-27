# Case Intelligence

A RAG system for community-corrections case managers: ask open-ended questions across client transcripts and policy documents, get an answer grounded in and cited to the actual evidence, over a live chat with follow-ups.

Built for the take-home brief at [docs/notion-AI-RAG-Case-Intelligence-System...md](docs/notion-AI-RAG-Case-Intelligence-System-3c946b36b2e980a5b16be77ddeb8e640.md). Design reasoning, decisions, and rejected alternatives are in [plan/](plan/) — start with [plan/00-architecture.md](plan/00-architecture.md).

## Quick start

```bash
git clone <repo-url> && cd <repo>
cp .env.example .env
# edit .env: set ANTHROPIC_API_KEY, and one embedding provider key (see below)
docker compose up --build
```

Open **http://localhost:3000**. The API listens immediately; the bundled dataset (5 transcripts, 5 policy documents) indexes in the background — a banner in the UI shows progress, and you can start asking questions about whatever's already indexed while the rest catches up.

### API keys

| Key | Required | Get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Always | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| One of `VOYAGE_API_KEY` / `GEMINI_API_KEY` / `JINA_API_KEY` | One, matching `EMBEDDING_PROVIDER` | See `.env.example` — each has setup instructions and free-tier notes |

**Read the free-tier caveat in `.env.example` before picking an embedding provider.** Voyage (the default) has a very low no-payment-method free tier (3 requests/min, 10K tokens/min) — too slow to ingest this corpus in reasonable time. `EMBEDDING_PROVIDER=gemini` or `=jina` have much more headroom for a demo. Embeddings from different providers are not interchangeable; switching providers after ingesting means dropping the Qdrant collection and re-ingesting everything (the app detects and refuses to boot against a mismatched collection rather than silently serving nonsense).

## What it does

- Single-page chat UI: ask a question, get an answer with expandable source cards, loading/error states, live conversation history.
- Upload your own transcripts or documents (PDF, DOCX, TXT, MD) — the same pipeline that indexes the bundled dataset processes them, with live per-file progress.
- Every answer is grounded in retrieved evidence and cites its sources; when the evidence is insufficient, it says so rather than guessing.
- Multi-turn conversations — follow-up questions ("what about his employment?") resolve against what was discussed earlier in the thread.

## Architecture, briefly

**Ingestion is chunked per-document-structure, not by one fixed splitter.** The five bundled reference documents have three different native shapes, discovered by reading the actual files rather than assumed: two are short atomic policy lists that must stay whole (splitting "did the case manager follow *all* the check-in guidelines" across chunks would break that exact question), one has clean regex-detectable numbered section headers, one is a 63-page state standards document with its own built-in citable code scheme (`CD-080: Enhance Intrinsic Motivation`) that we split on directly, and one has inconsistent enough formatting to need an LLM-assisted segmentation fallback. The router tries structural detection first and only falls back to an LLM call when nothing matches — most documents chunk with zero extra LLM cost.

**Transcripts arrive as raw, unlabeled ASR text** — no speaker tags, inconsistent casing, sometimes merged run-on segments. A dedicated LLM pass re-segments each transcript into labeled turns (case manager vs. client) before chunking, using the case manager's recognizable check-in script as the discriminating signal. The original raw text is always retained alongside the labeled version, and a labeling pass that looks unreliable (skewed speaker balance, low text coverage) is flagged (`labelingSuspect`) rather than silently trusted — labels are marked `inferred`, not ground truth.

**Retrieval is hybrid and query-routed, never a blanket dump of the corpus.** Every question passes through a query-analysis step that classifies its shape (factoid / broad-theme / multi-hop / comparison), resolves client entities against the real client table, and resolves phrases like "last meeting" to `MAX(session_date)` in SQL rather than by fuzzy search. Dense (Qdrant) and sparse/keyword (Postgres full-text) search run in parallel and are merged by reciprocal rank fusion — sparse search is what lets an exact query like "what is CD-080?" hit precisely. A multi-hop question like *"did the case manager use the 2nd principle of effective intervention in Nathan's last meeting?"* decomposes into two retrievals — one for the principle's definition (a policy document), one for Nathan's actual most recent transcript — and pulls chunks from both. The final candidate set handed to the model is capped regardless of strategy, which is the concrete answer to "never send the whole corpus to the LLM."

**Generation does relevance-filtering, synthesis, and citation in one call**, not a separate reranking step — the candidate set is small enough (~15 chunks) that a dedicated reranker earns nothing here. The model picks which supplied chunks are actually relevant, cites only chunk *ids* from that list (never free text it could hallucinate a source name into), and explicitly flags when evidence is insufficient. A bounded single retry widens the search once if the first pass comes back insufficient — not open-ended agentic looping.

**Ingestion runs off the request path**, on a Redis/BullMQ queue processed by a separate worker process. The API starts serving immediately rather than blocking on the ~10-file bootstrap ingest, uploads return in milliseconds with a job id you can poll or stream progress from, and a `Source.status` lifecycle (`pending → processing → ready → failed`) is what keeps two non-transactional stores (Postgres + Qdrant) consistent — retrieval only ever reads `ready` sources, so a job that dies partway through never serves a half-indexed document.

See [plan/00-architecture.md](plan/00-architecture.md) for the full decision record, including what was deliberately **not** built (Kafka, a trained/dedicated reranker, token-level answer streaming) and why.

## Project layout

```
apps/backend/    Express + Bun API and worker (TypeScript)
apps/frontend/   React + Vite single-page UI
docs/            The assignment brief and bundled dataset
plan/            Architecture decisions and phase-by-phase design notes
```

## API reference

Full contract in [plan/08-api-contract.md](plan/08-api-contract.md). The essentials:

```bash
# Ask a question
curl -X POST localhost:3001/api/ask -H 'content-type: application/json' \
  -d '{"question": "When should a client submit a grievance?"}'
# -> { answer, sources[], sufficientEvidence, assumptions[], conversationId, ... }
# Pass the returned conversationId on your next call to continue the thread.

# Upload a file
curl -X POST localhost:3001/api/upload -F file=@your-document.pdf
# -> 202 { jobId, status: "queued" }
curl localhost:3001/api/jobs/<jobId>            # poll
curl -N localhost:3001/api/jobs/<jobId>/events  # or stream progress via SSE

# What's indexed right now
curl localhost:3001/api/sources
curl localhost:3001/api/health

# See retrieval candidates for a question without spending a generation call
curl -X POST localhost:3001/api/debug/retrieval -H 'content-type: application/json' \
  -d '{"question": "What are the key themes Robert talks about?"}'
```

## Known limitations

Stated plainly rather than left for a reviewer to discover:

- **Transcript speaker labels are LLM-inferred, not ground truth.** A low-confidence labeling pass is flagged (`labelingSuspect`) but still ingested; the generation prompt is instructed to hedge attribution claims accordingly.
- **No OCR.** A scanned/image-only PDF extracts to near-zero words and is rejected outright rather than silently ingested empty.
- **Two of the five bundled reference documents (~500 words total — the check-in guidelines and the 8 principles of effective intervention) are pinned verbatim in the cached system prompt**, not retrieved per-query. They're the evaluative rubric a large share of the interesting questions reference directly; everything else in the corpus is retrieved. This is stated here explicitly so it isn't mistaken for bypassing the "real retrieval" requirement — it's two small documents, not the corpus.
- **Client identity for the bundled dataset is parsed from filenames** (`name-MM-DD.pdf`, tolerant of inconsistent zero-padding). Uploaded files won't reliably follow that convention, so identity falls back to content extracted during transcript labeling, and is left unset (surfaced in the upload response, never silently guessed) if neither source succeeds.
- **No auth or multi-tenancy** — this is a single-reviewer local demo, not a deployed multi-user service.
- **No formal retrieval evaluation harness.** `/api/debug/retrieval` makes retrieval quality inspectable per-query, but there's no golden-question regression set. This would be the highest-value next investment for taking this from "demonstrably reasoning correctly on the questions I tried" to "measurably good."
- **No dedicated/trained reranker**, by design — see the architecture doc for why that wasn't worth building at this corpus size.

## What I'd do next

- A retrieval evaluation harness: a golden-question set with expected source documents, scored for precision/recall, run in CI against retrieval changes.
- Scale the "broad theme" retrieval path from per-client to hierarchical (per-session → per-client → per-caseload) summaries as the number of transcripts per client grows well past this demo's 2–3.
- Horizontal worker scaling for ingestion throughput — the queue already coordinates multiple worker replicas, only compose's `deploy.replicas` needs bumping.
