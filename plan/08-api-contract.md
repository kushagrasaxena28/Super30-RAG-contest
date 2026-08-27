# 08 — API contract

**Goal:** the frozen HTTP surface. This doubles as the frontend handoff — `apps/frontend` is built against this file, so it should stop changing once phase 08 lands.

## Endpoints

### `POST /api/ask`
```jsonc
// →
{ "question": "string", "conversationId": "uuid?" }

// ←  200
{
  "conversationId": "uuid",
  "messageId": "uuid",
  "answer": "string",
  "sources": [{
    "chunkId": "uuid",
    "label": "Robert — Transcript 2 (2025-05-21)",   // display-ready
    "sourceType": "transcript" | "reference_document",
    "clientName": "string?",
    "sessionDate": "2025-05-21?",
    "section": "string?",          // e.g. "Timeline for Filing a Grievance"
    "standardCode": "string?",     // e.g. "CD-080"
    "excerpt": "string",
    "isSummary": false
  }],
  "sufficientEvidence": true,
  "assumptions": ["string"],
  "timings": { "analysisMs": 0, "retrievalMs": 0, "generationMs": 0 }
}
```
`label` is server-assembled and display-ready — the frontend never composes source names.

### `POST /api/upload`
`multipart/form-data`, field `file`. → `202`
```jsonc
{ "jobId": "sha256", "status": "queued", "deduplicated": false }
```
`deduplicated: true` when the content hash already exists (includes the existing `sourceId`). Errors: `415` unsupported type, `413` too large, `400` unreadable.

### `GET /api/jobs/:id`
```jsonc
{
  "jobId": "string",
  "state": "queued|active|completed|failed",
  "stage": "extracting|classifying|labeling|chunking|embedding|storing|summarizing|ready",
  "progress": 0.6,
  "result": { "sourceId": "uuid", "sourceType": "transcript", "clientName": "Nathan",
              "chunkCount": 14, "warnings": [] },
  "error": "string?"
}
```

### `GET /api/jobs/:id/events`
SSE. Emits current state immediately on connect, then `stage` events, then a terminal `ready`/`failed` and closes. Heartbeat every 15s.

### `GET /api/sources`
```jsonc
{ "sources": [{ "id", "filename", "sourceType", "status", "clientName",
                "sessionDate", "chunkCount", "labelingSuspect", "createdAt" }] }
```
How the reviewer confirms what's actually indexed without touching the DB.

### `DELETE /api/sources/:id`
Removes chunks + Qdrant points + the row. Lets a reviewer undo a bad upload without rebuilding containers. Cheap to add, disproportionately reassuring.

### `GET /api/conversations/:id`
Full message history with sources. `GET /api/conversations` lists recent threads.

### `GET /api/health`
```jsonc
{ "status": "ok", "postgres": true, "qdrant": true, "redis": true,
  "ingestion": { "pending": 0, "processing": 0, "ready": 10, "failed": 0 } }
```

### `POST /api/debug/retrieval`
Query analysis + scored candidates, no generation. See [05](05-retrieval.md).

## Conventions

- Errors: `{ error: { code, message, details? } }`. Never leak stack traces or raw API errors.
- Every response carries `X-Request-Id`; it appears in logs.
- CORS enabled for the frontend origin.
- `POST /api/ask` timeout ~60s (worst case: analysis + 2 generations).
- Upload cap 25MB, enforced by multer *and* checked before disk write.

## Frontend handoff (apps/frontend — later phase)

Needs, minimally:
- Question input + answer + expandable source cards + loading/error states (the brief's four requirements).
- Upload with per-file progress driven by the jobs SSE/poll endpoint.
- Conversation thread view passing `conversationId` through.
- A "sources indexed" panel from `GET /api/sources` — makes the system legible at a glance.
- Visible handling of `sufficientEvidence: false` and `assumptions` — surfacing honest uncertainty is a feature, not an error state to hide.

## Done when

- Every endpoint returns its documented shape.
- The full happy path works by curl alone, no frontend.
- Error cases return structured errors, never HTML stack traces.
