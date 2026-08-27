# 03 — Async jobs & worker process

**Goal:** ingestion moves off the request path entirely. API stays responsive; uploads report live progress; failures are retried and visible.

## Deliverables

```
src/jobs/queue.ts        BullMQ Queue + QueueEvents singletons
src/jobs/types.ts        IngestJobData, IngestJobResult, JobStage
src/jobs/ingestJob.ts    the processor — orchestrates phase 02 + 04
src/worker/index.ts      Worker registration, concurrency, shutdown
src/api/routes/jobs.ts   GET /api/jobs/:id, GET /api/jobs/:id/events (SSE)
src/api/bootstrap.ts     enqueue bundled dataset on API boot
```

## Job contract

```ts
IngestJobData = {
  filePath: string        // path in the shared volume
  originalName: string
  contentHash: string
  origin: "bootstrap" | "upload"
}

IngestJobResult = {
  sourceId, sourceType, clientId?, clientName?,
  chunkCount, labelingSuspect?, warnings: string[]
}

JobStage = "queued" | "extracting" | "classifying" | "labeling"
         | "chunking" | "embedding" | "storing" | "summarizing" | "ready"
```

`jobId = contentHash` → duplicate uploads are rejected by BullMQ automatically. On a duplicate, look up the existing `Source` and return it with `deduplicated: true` rather than erroring — re-uploading the same file should be a no-op, not a failure.

## Processor flow

```
mark Source pending
  → extract        (02)
  → classify       (02)
  → route + chunk  (02)     [labeling happens here for transcripts]
  → embed          (04)     bounded-concurrency batches
  → store          (04)     Postgres chunks → Qdrant points
  → summarize      (04)     per-source + refresh per-client summary
  → mark Source ready
```

`job.updateProgress({stage, pct, detail})` at every arrow. On throw: `Source.status = failed`, `Source.error` set, chunks/points for that source cleaned up so nothing half-indexed survives.

## Retry policy

- 3 attempts, exponential backoff from ~2s.
- Transient (429, 5xx, network, timeout) → retry.
- Deterministic (unsupported type, unextractable text, `BadRequestError`) → `UnrecoverableError`, fail immediately. Retrying a corrupt PDF three times just wastes 90 seconds and muddies the logs.
- `removeOnComplete: {age: 3600}`, `removeOnFail: false` — keep failures inspectable.

## Progress delivery

`QueueEvents` is already a Redis pub/sub bridge — use it rather than writing custom pub/sub. The API subscribes and fans out to SSE clients.

**SSE endpoint discipline** (these are the things that break in practice):
- `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- Heartbeat comment every ~15s or intermediaries kill the idle connection.
- Clean up the `QueueEvents` listener on `req.on("close")` — otherwise every reload leaks a listener.
- Terminal event (`ready` / `failed`) then `res.end()`.
- **Send the current state immediately on connect**, before streaming deltas. A client that connects after the job finished must still get a terminal event instead of hanging forever.

Polling (`GET /api/jobs/:id`) stays available as the simple path — SSE is the upgrade, not the only option.

## Bootstrap ingestion

On API boot (after migrate), scan the dataset dirs and enqueue one job per file. Idempotent twice over: content-hash dedup in the DB *and* `jobId` dedup in BullMQ. Restarting compose re-enqueues nothing and spends no API calls.

`GET /api/health` reports `{ingestion: {pending, processing, ready, failed}}` so a frontend can show "indexing 3 of 10…" rather than an empty state that looks broken.

## Graceful shutdown

`SIGTERM` → `worker.close()` (finishes in-flight jobs, stops accepting new) → close Redis/Prisma/Qdrant → exit. Without this, `docker compose down` mid-job leaves a source stuck in `processing` forever.

Add a startup reconciliation: any `Source` left in `processing` at boot with no active job gets marked `failed` so it can be retried rather than blocking silently.

## Done when

- `POST /api/upload` returns `202` in <500ms with a large PDF.
- `GET /api/jobs/:id/events` streams every stage transition to completion.
- Killing the worker mid-job and restarting it → job retries, source ends `ready`, no duplicate chunks.
- Uploading the same file twice → second returns `deduplicated: true`, chunk count unchanged.
- A corrupt PDF fails fast (one attempt), `Source.status = failed`, error readable via the API.
- `docker compose restart` → no re-embedding, no duplicate rows.

## Cut / risk

- **SSE is the cut, not the queue.** If time-pressed, ship polling only — the async architecture and its correctness properties remain; the client just polls every 2s.
- Don't cut the queue itself to "save time": a synchronous upload path is the single worst reviewer experience in this system, and it's the path they were explicitly told to exercise.
