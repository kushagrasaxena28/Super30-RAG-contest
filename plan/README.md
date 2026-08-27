# Implementation Plan — Case Intelligence RAG

Phase-by-phase build plan. Each file is independently reviewable: read one, critique it, revise it, without re-reading the others. Phases are ordered by dependency, but the *content* of a later phase can be revised at any time.

## How to use this folder

- `00-architecture.md` is the only file you must read to understand the system. Everything else is execution detail.
- Each phase file has the same shape: **Goal → Deliverables → Key decisions → Implementation notes → Done when → Cut/risk**.
- "Done when" lines are the acceptance criteria. A phase isn't finished until they pass.
- Revise a phase file in place as we learn things during the build. Treat these as living documents, not a frozen contract.

## Phases

| # | Phase | Depends on | Status |
|---|---|---|---|
| [00](00-architecture.md) | Architecture & decision record | — | Draft |
| [01](01-foundation.md) | Foundation: repo, config, schema, compose | — | Not started |
| [02](02-ingestion.md) | Ingestion: extract, classify, chunk | 01 | Not started |
| [03](03-jobs-and-workers.md) | Async jobs, worker process, progress | 01 | Not started |
| [04](04-embeddings-and-storage.md) | Embeddings, dual-store writes, consistency | 01, 02 | Not started |
| [05](05-retrieval.md) | Hybrid search, query analysis, strategies | 04 | Not started |
| [06](06-generation.md) | Prompt assembly, structured answers, citations | 05 | Not started |
| [07](07-conversation.md) | Multi-turn history + context compression | 06 | Not started |
| [08](08-api-contract.md) | Full HTTP surface (frontend contract) | 03, 06, 07 | Not started |
| [09](09-hardening.md) | Security, injection, rate limits, observability | 02–08 | Not started |
| [10](10-verification.md) | End-to-end acceptance tests | all | Not started |
| [11](11-delivery.md) | README, .env.example, architecture writeup | all | Not started |

Supporting: [SKILLS.md](SKILLS.md) — which skills to invoke at which phase, and what each corrects.

## Critical path

If everything else slipped, this is the minimum that satisfies the brief:

**01 → 02 → 04 → 05 → 06 → 08(ask only) → 11**

Phases 03 (async), 07 (conversation), and 09 (hardening) are what make it *production-grade* and what the user explicitly asked for — but the brief is technically satisfiable without them. Phase 03 is strongly recommended regardless, because a synchronous upload endpoint is a genuinely bad experience for the reviewer who was told to upload their own files.

## Non-negotiables (from the brief + user)

1. Retrieval must be query-dependent — never send the whole corpus to the LLM.
2. `docker compose up` + API keys = working app, no extra manual steps.
3. Every answer shows its sources.
4. Reviewer uploads their own files and it must work.
5. Multi-turn conversation must work.
6. No hardcoded answers — unseen questions will be tested.
