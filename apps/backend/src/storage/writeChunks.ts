import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { qdrant } from "../db/qdrant.js";
import { env } from "../config/env.js";
import { embed } from "../embeddings/index.js";
import type { PendingChunk } from "../ingestion/types.js";

export interface WrittenChunk {
  id: string;
  text: string;
}

/**
 * Dual-store write. Postgres and Qdrant can't share a transaction - the
 * ordering is the correctness argument (see plan/04):
 *
 *   1. Postgres: insert Chunk rows (source still `processing`) - ids assigned here
 *   2. Qdrant:   upsert points, point.id = chunk.id - deterministic, idempotent
 *
 * Step 3 (Source.status = ready) is the caller's responsibility, after
 * summarize() has also run - see src/jobs/ingestJob.ts. Retrieval filters
 * on Source.status = ready, so a crash between 1 and 2 leaves an invisible
 * partial source rather than a corrupt visible one; a retry re-upserts by
 * the same ids and converges.
 */
export async function writeChunks(sourceId: string, chunks: PendingChunk[]): Promise<WrittenChunk[]> {
  if (chunks.length === 0) return [];

  const ids = chunks.map(() => randomUUID());

  await prisma.chunk.createMany({
    data: chunks.map((c, i) => ({
      id: ids[i]!,
      sourceId,
      text: c.text,
      metadata: c.metadata as object,
    })),
  });

  const vectors = await embed(
    chunks.map((c) => c.text),
    "document",
  );

  await qdrant.upsert(env.QDRANT_COLLECTION, {
    points: chunks.map((c, i) => ({
      id: ids[i]!,
      vector: vectors[i]!,
      payload: {
        sourceId,
        clientId: c.metadata.clientId ?? null,
        sourceType: c.metadata.sourceType,
        isSummary: c.metadata.isSummary,
        sessionDate: c.metadata.sessionDate ?? null,
      },
    })),
  });

  return chunks.map((c, i) => ({ id: ids[i]!, text: c.text }));
}

/** Cleanup on permanent ingestion failure - delete this source's chunks and
 * points so nothing half-indexed survives (see plan/03, plan/04). */
export async function deleteChunksForSource(sourceId: string): Promise<void> {
  await qdrant.delete(env.QDRANT_COLLECTION, {
    filter: { must: [{ key: "sourceId", match: { value: sourceId } }] },
  });
  await prisma.chunk.deleteMany({ where: { sourceId } });
}
