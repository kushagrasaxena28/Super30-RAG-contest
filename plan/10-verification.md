# 10 — Verification

**Goal:** prove it works, from a cold clone, the way the reviewer will.

## Cold-start test (the one that actually matters)

```bash
git clone <repo> && cd <repo>
cp .env.example .env      # add ANTHROPIC_API_KEY + VOYAGE_API_KEY
docker compose up
```

Must hold:
- API answers `/api/health` within ~30s (**not** blocked on ingestion).
- Health shows ingestion progressing, then `ready: 10`.
- No manual migration, seeding, or extra command.
- `docker compose down && docker compose up` → no re-embedding (verify: zero embedding calls in logs).

## Ingestion checks

```bash
curl localhost:3001/api/health | jq .ingestion
curl localhost:3001/api/sources | jq '.sources[] | {filename, sourceType, status, clientName, chunkCount}'
curl localhost:6333/collections/case_chunks | jq .result.points_count
```

- 10 sources, all `ready`.
- Qdrant `points_count` == total chunks of `ready` sources.
- 5 transcripts have `clientName` (Robert ×2, Nathan ×3) and correct `sessionDate`.
- Chunk counts roughly: check-in 1, principles 1, grievance ~5–7, programming ~10, standards dozens, transcripts several each + summaries.

## Retrieval checks (before generation — use the debug endpoint)

```bash
curl -sX POST localhost:3001/api/debug/retrieval \
  -H 'content-type: application/json' \
  -d '{"question":"When should a client submit a grievance?"}' | jq
```

| Question | Expect in candidates |
|---|---|
| "When should a client submit a grievance?" | grievance doc, Timeline section, top-ranked |
| "What is CD-080?" | that exact standard chunk (proves sparse retrieval works) |
| "What are key themes Robert talks about?" | Robert summary chunks; **no** Nathan chunks |
| "Did the CM use the 2nd principle in Nathan's last meeting?" | 8-Principles doc **and** `nathan-06-02` chunks |
| "What is Nathan's relationship with his family like?" | Nathan transcript chunks across multiple sessions |

The fourth is the strongest single test — client resolution + `MAX(sessionDate)` + multi-hop + cross-origin in one query.

## End-to-end QA

```bash
curl -sX POST localhost:3001/api/ask -H 'content-type: application/json' \
  -d '{"question":"When should a client submit a grievance?"}' | jq '{answer, sources: [.sources[].label], sufficientEvidence}'
```

Run every example question from the brief plus unseen ones. Check: answer grounded, sources correct and real, `sufficientEvidence` honest.

**Negative test:** `"What is Robert's blood type?"` → `sufficientEvidence: false`, no invention.

**Ambiguity test:** `"Did the case manager follow all the check-in guidelines?"` (no client named) → `assumptions` states which session it used.

## Multi-turn

```bash
CID=$(curl -sX POST localhost:3001/api/ask -H 'content-type: application/json' \
  -d '{"question":"Tell me about Nathan'\''s family situation"}' | jq -r .conversationId)

curl -sX POST localhost:3001/api/ask -H 'content-type: application/json' \
  -d "{\"question\":\"what about his employment?\",\"conversationId\":\"$CID\"}" | jq
```
Second answer must be about **Nathan's** employment — name never repeated.

Then: `"actually, when can anyone file a grievance?"` on the same thread → must go general, **not** stay Nathan-scoped. (The over-reach risk from [07](07-conversation.md).)

## Upload

```bash
curl -sX POST localhost:3001/api/upload -F file=@/path/to/new-doc.pdf | jq
curl -N localhost:3001/api/jobs/<jobId>/events
```

- Returns 202 in <500ms.
- SSE streams stages to `ready`.
- New source in `/api/sources`; immediately queryable.
- **Same file again** → `deduplicated: true`, no new chunks.
- **Policy doc renamed `nathan-transcript.pdf`** → still classified `reference_document`.
- **A `.txt` and a `.docx`** → both ingest.
- **A renamed non-PDF** → rejected 415.
- **Upload during an active query** → query unaffected (proves the async split).

## Failure & recovery

- Kill worker mid-job, restart → retries, ends `ready`, no duplicates.
- Corrupt PDF → fails fast, `status: failed`, error readable, other sources unaffected.
- Stop Qdrant → health reports it, ask returns a clean error not a crash.
- Bad `ANTHROPIC_API_KEY` → clear startup/first-call error, not a mystery 500.

## Pre-submission

- `/code-review` on the full diff.
- `/security-review` — specifically the upload path.
- `grep` for `exec(`, `console.log` of chunk text, committed `.env`.
- Fresh clone into a clean directory and run the cold-start test again.
