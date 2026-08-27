import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export interface FtsHit {
  id: string;
  text: string;
  metadata: unknown;
  sourceId: string;
  rank: number;
}

export interface FtsFilter {
  clientId?: string;
  sourceType?: "transcript" | "reference_document";
  excludeSummaries?: boolean;
  sessionDate?: string; // ISO date (YYYY-MM-DD), exact match
}

/**
 * Keyword search over the generated tsvector column (see the 0002_chunk_fts
 * migration) - catches exact terms embeddings blur: standard codes
 * ("CD-080"), proper nouns, domain phrases like "ankle monitor" (see
 * plan/05-retrieval.md). Always filters Source.status = 'ready'.
 */
export async function ftsSearch(query: string, limit: number, filter: FtsFilter = {}): Promise<FtsHit[]> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"Chunk"."searchVector" @@ plainto_tsquery('english', ${query})`,
    Prisma.sql`"Source"."status" = 'ready'`,
  ];
  if (filter.clientId) conditions.push(Prisma.sql`"Source"."clientId" = ${filter.clientId}`);
  if (filter.sourceType) conditions.push(Prisma.sql`"Source"."sourceType" = ${filter.sourceType}::"SourceType"`);
  if (filter.excludeSummaries) conditions.push(Prisma.sql`("Chunk"."metadata"->>'isSummary')::boolean IS NOT TRUE`);
  if (filter.sessionDate) conditions.push(Prisma.sql`"Source"."sessionDate"::date = ${filter.sessionDate}::date`);

  const rows = await prisma.$queryRaw<
    Array<{ id: string; text: string; metadata: unknown; sourceId: string; rank: number }>
  >(Prisma.sql`
    SELECT "Chunk"."id", "Chunk"."text", "Chunk"."metadata", "Chunk"."sourceId",
           ts_rank("Chunk"."searchVector", plainto_tsquery('english', ${query})) AS rank
    FROM "Chunk"
    JOIN "Source" ON "Source"."id" = "Chunk"."sourceId"
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY rank DESC
    LIMIT ${limit}
  `);

  return rows;
}
