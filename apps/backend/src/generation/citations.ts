import path from "node:path";
import { prisma } from "../db/prisma.js";
import { orderAndDropUnknown } from "./citationFilter.js";
import type { ChunkMetadata, SourceTypeValue } from "../types/domain.js";

export interface DisplaySource {
  chunkId: string;
  label: string;
  sourceType: SourceTypeValue;
  clientName?: string;
  sessionDate?: string;
  section?: string;
  standardCode?: string;
  excerpt: string;
  isSummary: boolean;
}

const EXCERPT_MAX_CHARS = 500;

/**
 * Chunk ids -> display sources, assembled from database rows. Citations
 * are chunk *ids*, never free text the model writes - the model picking
 * from a supplied id list makes fabricated sources structurally impossible
 * (see plan/06-generation.md). `label` is server-assembled and
 * display-ready; the frontend never composes source names.
 */
export async function resolveCitations(chunkIds: string[]): Promise<DisplaySource[]> {
  if (chunkIds.length === 0) return [];

  const chunks = await prisma.chunk.findMany({
    where: { id: { in: chunkIds } },
    include: { source: { include: { client: true } } },
  });

  // Preserve the order the model cited them in, drop anything unrecognized
  // (see citationFilter.ts - the anti-fabricated-citation guarantee).
  const results: DisplaySource[] = [];
  for (const chunk of orderAndDropUnknown(chunkIds, chunks, (c) => c.id)) {
    const metadata = chunk.metadata as unknown as ChunkMetadata;
    const source = chunk.source;
    const sessionDate = source.sessionDate?.toISOString().slice(0, 10);
    const sourceType: SourceTypeValue = (source.sourceType as SourceTypeValue) ?? "reference_document";

    results.push({
      chunkId: chunk.id,
      label: await buildLabel(source.id, source.filename, sourceType, source.client?.name, sessionDate, source.clientId),
      sourceType,
      clientName: source.client?.name,
      sessionDate,
      section: metadata.categoryOrSection,
      standardCode: metadata.standardCode,
      excerpt: chunk.text.length > EXCERPT_MAX_CHARS ? `${chunk.text.slice(0, EXCERPT_MAX_CHARS)}…` : chunk.text,
      isSummary: metadata.isSummary,
    });
  }
  return results;
}

async function buildLabel(
  sourceId: string,
  filename: string,
  sourceType: SourceTypeValue,
  clientName: string | undefined,
  sessionDate: string | undefined,
  clientId: string | null,
): Promise<string> {
  if (sourceType === "transcript" && clientName && clientId) {
    const ordinal = await transcriptOrdinal(sourceId, clientId);
    const dateSuffix = sessionDate ? ` (${sessionDate})` : "";
    return ordinal ? `${clientName} — Transcript ${ordinal}${dateSuffix}` : `${clientName} — Transcript${dateSuffix}`;
  }

  return path.basename(filename, path.extname(filename));
}

/** 1-indexed position of this source among the client's transcripts, ordered by session date. */
async function transcriptOrdinal(sourceId: string, clientId: string): Promise<number | null> {
  const siblings = await prisma.source.findMany({
    where: { clientId, sourceType: "transcript", status: "ready" },
    orderBy: [{ sessionDate: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const index = siblings.findIndex((s) => s.id === sourceId);
  return index === -1 ? null : index + 1;
}
