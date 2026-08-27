# 11 — Delivery

**Goal:** the submission artifacts. The brief names these explicitly — they're graded, not optional garnish.

## Required by the brief

1. GitHub repository
2. Working application
3. README with setup instructions
4. `.env.example`
5. Short explanation of the RAG architecture

## README structure

**Quick start first** — the reviewer's first 60 seconds decide a lot:
```bash
git clone <repo> && cd <repo>
cp .env.example .env     # add your two API keys
docker compose up
# open http://localhost:3000
```
State plainly: two keys needed (Anthropic, Voyage), first boot indexes the bundled dataset in the background, API is usable immediately.

**Then:**
- What it does + a screenshot.
- Architecture explanation (below).
- How to upload your own files — call this out prominently, they were told to test it.
- API reference (link [08](08-api-contract.md) content).
- Known limitations — see below.
- What I'd do next (from [00](00-architecture.md) scaling notes).

## The architecture explanation

The brief asks for "short," but this is where the actual thinking is visible. Aim for one tight page covering:

1. **Ingestion** — per-document chunking, and *why*: chunking was chosen by inspecting each real document's structure, not by applying one fixed splitter. The 63-page standards doc splits on its own `CS-010:` code scheme; the 213-word guidelines doc isn't split at all because the question "did the CM follow *all* the guidelines" needs all 11 items in one chunk.
2. **Transcript preprocessing** — the transcripts arrived as unlabeled ASR; speaker labeling is an LLM preprocessing pass, raw text is retained, labels are marked inferred.
3. **Retrieval** — hybrid dense+sparse with RRF, query analysis routing by question type, multi-hop decomposition, `MAX(sessionDate)` resolved in SQL. Include a worked example: how "did the CM use the 2nd principle in Nathan's last meeting" decomposes into two retrievals across two source types.
4. **Generation** — bounded candidate set, relevance filtering folded into generation, id-based citations that make fabricated sources structurally impossible.
5. **Async architecture** — why ingestion is queued and the API never blocks.
6. **What was deliberately not built** — Kafka, a trained reranker, token streaming — with the one-line reason each. Showing you considered and rejected them is stronger than silence.

A diagram helps. Mermaid in the README renders on GitHub.

## Known limitations — state these honestly

Volunteering these reads as engineering maturity; hiding them and having a reviewer find them reads as the opposite.

- Speaker labels are LLM-inferred, not ground truth; `labelingSuspect` flags low-confidence transcripts.
- No OCR — scanned/image-only PDFs are rejected rather than silently ingested empty.
- The two smallest reference docs (494 words total) are pinned in the cached system prompt because they're the evaluative rubric for many questions; everything else is retrieved. Say so explicitly so it isn't mistaken for bypassing retrieval.
- Client identity comes from filename convention with content-based fallback; production would take an explicit `clientId` at upload.
- No auth/multi-tenancy — single-tenant demo.
- No formal retrieval eval set (named as the top next investment).

## `.env.example`

Every key with a comment saying what it's for and where to get it. No real values. Confirm `.env` is gitignored and never committed — check the history, not just the working tree.

## Repo hygiene

- Remove `apps/web`, `apps/docs`, `packages/ui` starter boilerplate.
- `plan/` folder: keep it. It shows the reasoning. Link it from the README as "design notes."
- `docs/` holds the brief + dataset — note in the README that the dataset ships with the repo for reproducibility.
- Clean commit history with real messages.
- `.gitignore`: `.env`, `node_modules`, `UPLOAD_DIR`, `.DS_Store`.

## Done when

- Fresh clone → working app with only key insertion.
- README quick-start is literally copy-pasteable.
- Architecture explanation readable in ~3 minutes.
- No secrets in the repo or its history.
- `/code-review` and `/security-review` both clean.
