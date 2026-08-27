-- Hand-written migration: Prisma cannot express a GENERATED ALWAYS AS column,
-- so this is added directly rather than via `prisma migrate dev`. The
-- corresponding Prisma schema field is `searchVector Unsupported("tsvector")?`
-- - reads/writes go through raw SQL in src/db/fts.ts (phase 05), never
-- through the Prisma query builder.
-- The init migration already created a plain "searchVector" tsvector column
-- (Prisma emits a bare column for Unsupported() types); Postgres can't
-- ALTER an existing column into a generated one, so drop and recreate it.
ALTER TABLE "Chunk" DROP COLUMN "searchVector";

ALTER TABLE "Chunk" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED;

CREATE INDEX "chunk_search_idx" ON "Chunk" USING GIN ("searchVector");
