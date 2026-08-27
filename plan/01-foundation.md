# 01 — Foundation

**Goal:** a booting skeleton — containers up, schema migrated, both stores reachable, `/api/health` green. No RAG logic yet.

## Deliverables

**Repo housekeeping**
- Delete `project/apps/web` and `project/apps/docs` (stock Vercel/Next.js starter boilerplate, not our work).
- Delete `project/packages/ui` (placeholder React components).
- Keep `packages/typescript-config` and `packages/eslint-config` — real reusable configs, extend them.
- Decide repo root: the git repo is at `Jail_Thing/`, the workspace at `Jail_Thing/project/`. Either move `project/*` up to the root or leave it nested. **Recommend moving up** so a cloner gets `docker-compose.yml` at the repo root where they expect it.

**New: `apps/backend/`**
```
package.json          express, @anthropic-ai/sdk, @qdrant/js-client-rest, bullmq, ioredis,
                      @prisma/client, prisma, zod, multer, pino
tsconfig.json         extends ../../packages/typescript-config/base.json
Dockerfile            oven/bun base + apt-get install poppler-utils
src/config/env.ts     zod-validated process.env, parsed once, exported typed
src/config/constants.ts
src/db/prisma.ts      PrismaClient singleton
src/db/qdrant.ts      client + ensureCollection() (idempotent)
src/redis.ts          ioredis connection (shared by BullMQ + caches)
src/api/app.ts        express assembly + error middleware
src/api/server.ts     listen bootstrap
src/api/routes/health.ts
src/worker/index.ts   stub worker that boots and logs (real jobs land in phase 03)
src/scripts/migrate.ts  runs prisma migrate deploy + ensureCollection, exits
```

**Root**
- `docker-compose.yml` — postgres, qdrant, redis, migrate, api, worker
- `.env.example`
- `.dockerignore`

## Prisma schema

```
Client       id, name, createdAt
Source       id, filename, contentHash @unique, sourceType(enum), status(enum),
             clientId?, sessionDate?, rawText?, error?, createdAt, updatedAt
Chunk        id, sourceId, text, metadata(Json), searchVector(Unsupported tsvector?),
             createdAt
Conversation id, createdAt, summary?, summarizedUpTo?
Message      id, conversationId, role(enum), content, sources(Json?), tokenCount?, createdAt
```

Enums: `SourceType {transcript, reference_document}`, `SourceStatus {pending, processing, ready, failed}`, `MessageRole {user, assistant}`.

`Chunk.metadata` jsonb shape (typed in `src/types/domain.ts`, not just `any`):
`{ clientId?, sourceType, sessionDate?, categoryOrSection?, standardCode?, isSummary, speakerSource?, turnRange? }`

Index `Chunk.sourceId`, `Source.contentHash`, `Source.status`.

**Migration 0002 (hand-written SQL)** — Prisma can't express generated tsvector columns:
```sql
ALTER TABLE "Chunk" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED;
CREATE INDEX chunk_search_idx ON "Chunk" USING GIN ("searchVector");
```

## Key decisions

- **Conversation/Message ship in the first migration**, not bolted on in phase 07. Adding them later means a second migration and a schema churn for no reason — we already know they're coming.
- **`Source.status` exists from day one.** It's the consistency mechanism (see [00](00-architecture.md)), not an afterthought.
- **`env.ts` validates with zod and throws on boot** if a required key is missing. A missing `ANTHROPIC_API_KEY` should fail loudly at startup with a readable message, not produce a confusing 500 on the first question.

## `.env.example`

```
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
DATABASE_URL=postgresql://rag:rag@postgres:5432/casedb
QDRANT_URL=http://qdrant:6333
REDIS_URL=redis://redis:6379
QDRANT_COLLECTION=case_chunks
PORT=3001
INGESTION_DOCS_DIR=/data/docs
INGESTION_TRANSCRIPTS_DIR=/data/transcripts
UPLOAD_DIR=/data/uploads
WORKER_CONCURRENCY=3
CONVERSATION_TOKEN_BUDGET=120000
```

## Implementation notes

- Dockerfile needs `poppler-utils`; verify with `pdftotext -v` in the built image before moving on — a missing binary surfaces as a confusing runtime failure much later otherwise.
- `ensureCollection()` must tolerate "already exists" (concurrent/repeat calls) rather than throwing.
- Compose: `api` and `worker` both `depends_on: {migrate: {condition: service_completed_successfully}}`; `migrate` depends on postgres healthy.
- Bind-mount the dataset read-only into `/data/docs` and `/data/transcripts`; use a named volume for `/data/uploads`.

## Done when

- `docker compose up` brings all services up with no restart loops.
- `curl localhost:3001/api/health` → `{status:"ok", postgres:true, qdrant:true, redis:true}`.
- `prisma migrate deploy` is idempotent across restarts.
- `pdftotext -v` works inside the api image.
- Qdrant collection exists with the right dimension.

## Cut / risk

- **Bun + Prisma compatibility** is the main unknown. Prisma's engine has historically been the friction point under Bun. If it fights us, the fallback is running the backend on Node in the container while keeping Bun for tooling/workspaces — the code doesn't change. **Test this in the first 20 minutes**; it's the single highest-risk assumption in the whole stack.
- Repo restructure (moving `project/*` to root) is cosmetic — skip if time-pressed, just document the path in the README.
