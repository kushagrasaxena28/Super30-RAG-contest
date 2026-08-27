import { prisma } from "../db/prisma.js";
import { qdrant } from "../db/qdrant.js";
import { env } from "../config/env.js";
import { embed } from "../embeddings/index.js";
import { ftsSearch } from "../db/fts.js";
import { fuseByRrf } from "./rrf.js";
import type { ChunkMetadata } from "../types/domain.js";

export interface Candidate {
  chunkId: string;
  text: string;
  metadata: ChunkMetadata;
  sourceId: string;
  denseRank: number | null;
  sparseRank: number | null;
  fusedScore: number;
}

export interface HybridSearchFilter {
  clientId?: string;
  sourceType?: "transcript" | "reference_document";
  excludeSummaries?: boolean;
  onlySummaries?: boolean;
  sessionDate?: string; // ISO date (YYYY-MM-DD), exact match - resolved by temporal.ts, never by similarity
}

const FETCH_MULTIPLIER = 3;
const MIN_FETCH = 30;

/**
 * Dense (Qdrant) + sparse (Postgres FTS) in parallel, fused with
 * Reciprocal Rank Fusion (k=60) - see plan/05-retrieval.md. RRF over
 * score-normalization because cosine similarity and ts_rank live on
 * incomparable scales; rank-based fusion sidesteps calibration entirely.
 * Both legs filter Source.status = 'ready'.
 */
export async function hybridSearch(query: string, k: number, filter: HybridSearchFilter = {}): Promise<Candidate[]> {
  const fetchCount = Math.max(k * FETCH_MULTIPLIER, MIN_FETCH);

  const qdrantFilter = buildQdrantFilter(filter);

  const [denseHits, sparseHits] = await Promise.all([
    denseSearch(query, fetchCount, qdrantFilter),
    ftsSearch(query, fetchCount, {
      clientId: filter.clientId,
      sourceType: filter.sourceType,
      excludeSummaries: filter.excludeSummaries,
      sessionDate: filter.sessionDate,
    }),
  ]);

  const fused = fuseByRrf(
    denseHits,
    sparseHits.map((h) => h.id),
  );
  const top = fused.slice(0, k);

  const chunkRows = await prisma.chunk.findMany({
    where: { id: { in: top.map((t) => t.chunkId) } },
  });
  const byId = new Map(chunkRows.map((c) => [c.id, c]));

  const candidates: Candidate[] = [];
  for (const t of top) {
    const row = byId.get(t.chunkId);
    if (!row) continue; // sparse hit whose chunk no longer exists (deleted mid-search) - skip
    candidates.push({
      chunkId: t.chunkId,
      text: row.text,
      metadata: row.metadata as unknown as ChunkMetadata,
      sourceId: row.sourceId,
      denseRank: t.denseRank,
      sparseRank: t.sparseRank,
      fusedScore: t.fusedScore,
    });
  }
  return candidates;
}

function buildQdrantFilter(filter: HybridSearchFilter) {
  const must: Array<Record<string, unknown>> = [];
  if (filter.clientId) must.push({ key: "clientId", match: { value: filter.clientId } });
  if (filter.sourceType) must.push({ key: "sourceType", match: { value: filter.sourceType } });
  if (filter.excludeSummaries) must.push({ key: "isSummary", match: { value: false } });
  if (filter.onlySummaries) must.push({ key: "isSummary", match: { value: true } });
  if (filter.sessionDate) must.push({ key: "sessionDate", match: { value: filter.sessionDate } });
  return must.length > 0 ? { must } : undefined;
}

async function denseSearch(
  query: string,
  limit: number,
  filter: ReturnType<typeof buildQdrantFilter>,
): Promise<string[]> {
  const [vector] = await embed([query], "query");
  const result = await qdrant.query(env.QDRANT_COLLECTION, {
    query: vector!,
    limit,
    filter,
    with_payload: false,
  });
  return result.points.map((r) => String(r.id));
}
