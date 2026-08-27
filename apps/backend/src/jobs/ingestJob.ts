import { readFile } from "node:fs/promises";
import { UnrecoverableError, type Job } from "bullmq";
import { prisma } from "../db/prisma.js";
import { logger } from "../logger.js";
import { detectType, extractText } from "../ingestion/extract.js";
import { IngestionError } from "../ingestion/errors.js";
import { classifySource } from "../ingestion/classify.js";
import { parseIdentityFromFilename } from "../ingestion/identity.js";
import { routeAndChunk } from "../ingestion/router.js";
import { summarizeSource, refreshClientRollingSummary } from "../ingestion/summaries.js";
import { writeChunks, deleteChunksForSource } from "../storage/writeChunks.js";
import { resolveOrCreateClient } from "../retrieval/clientResolver.js";
import { RefusalError } from "../llm/index.js";
import type { IngestJobData, IngestJobResult } from "./types.js";
import type { ChunkMetadata } from "../types/domain.js";

/**
 * The processor - orchestrates phase 02 (extract/classify/chunk) + phase 04
 * (embed/store/summarize). See plan/03-jobs-and-workers.md for the stage
 * contract and plan/00-architecture.md for why this is a single job per
 * file rather than a fan-out per stage.
 */
export async function processIngestJob(job: Job<IngestJobData>): Promise<IngestJobResult> {
  const { filePath, originalName, contentHash } = job.data;

  // The Source row is the job's first durable act, before anything that can
  // throw. Creating it only after classification (as this used to) meant a
  // file that died in extraction or classification left no row at all: it was
  // absent from GET /api/sources and invisible to /api/health's ingestion
  // counts, so the system reported a clean state while a file was silently
  // missing. That is exactly the partial-failure mode the Source.status
  // lifecycle in plan/00-architecture.md exists to surface - the status gate
  // just started one stage too late.
  //
  // Keyed on contentHash (unique), so BullMQ's retries re-claim the same row
  // rather than creating duplicates. sourceType stays null until classify
  // runs: it genuinely isn't known yet, and inferring it from the filename is
  // what plan/02-ingestion.md rules out.
  const source = await prisma.source.upsert({
    where: { contentHash },
    create: { filename: originalName, contentHash, status: "processing" },
    update: { filename: originalName, status: "processing", error: null },
  });
  const sourceId = source.id;

  try {
    // writeChunks mints fresh chunk ids on every call, so chunks left behind
    // by a previous attempt (or by an earlier ingest of the same contentHash)
    // would be additive rather than replaced. Clearing first is what keeps a
    // BullMQ retry from doubling this source's footprint in Postgres+Qdrant.
    await deleteChunksForSource(sourceId);

    await job.updateProgress({ stage: "extracting", pct: 0.05 });
    const buf = await readFile(filePath);
    const type = detectType(originalName, buf);
    const rawText = await extractText(filePath, type);

    await job.updateProgress({ stage: "classifying", pct: 0.15 });
    const classification = await classifySource(rawText);
    const sourceType = classification.sourceType;
    await prisma.source.update({ where: { id: sourceId }, data: { sourceType } });

    const filenameIdentity = parseIdentityFromFilename(originalName);

    await job.updateProgress({
      stage: sourceType === "transcript" ? "labeling" : "chunking",
      pct: 0.3,
    });
    const routed = await routeAndChunk(rawText, sourceType, {});

    const clientName = filenameIdentity.clientName ?? routed.clientNameFromContent ?? null;
    const sessionDate = filenameIdentity.sessionDate ?? routed.sessionDateFromContent ?? null;

    let clientId: string | undefined;
    if (sourceType === "transcript" && clientName) {
      clientId = await resolveOrCreateClient(clientName);
    }

    const chunksWithIdentity = routed.chunks.map((c) => ({
      ...c,
      metadata: {
        ...c.metadata,
        clientId,
        sessionDate: sessionDate ?? c.metadata.sessionDate,
      } as ChunkMetadata,
    }));

    await job.updateProgress({ stage: "embedding", pct: 0.55 });
    await job.updateProgress({ stage: "storing", pct: 0.7 });
    await writeChunks(sourceId, chunksWithIdentity);

    await job.updateProgress({ stage: "summarizing", pct: 0.85 });
    const summaryChunk = await summarizeSource({
      rawText,
      sourceType,
      clientId,
      sessionDate: sessionDate ?? undefined,
    });
    await writeChunks(sourceId, [summaryChunk]);

    if (clientId) {
      await refreshClientRollingSummary(clientId).catch((err) => {
        logger.error({ clientId, err: serializeErr(err) }, "rolling summary refresh failed (non-fatal)");
      });
    }

    await prisma.source.update({
      where: { id: sourceId },
      data: {
        status: "ready",
        rawText,
        clientId,
        sessionDate: sessionDate ? new Date(sessionDate) : undefined,
        labelingSuspect: routed.labelingSuspect,
      },
    });

    const chunkCount = await prisma.chunk.count({ where: { sourceId: sourceId } });
    await job.updateProgress({ stage: "ready", pct: 1 });

    logger.info(
      { sourceId: sourceId, sourceType, chunkCount, labelingSuspect: routed.labelingSuspect },
      "ingestion complete",
    );

    return {
      sourceId: sourceId,
      sourceType,
      clientId,
      clientName: clientName ?? undefined,
      chunkCount,
      labelingSuspect: routed.labelingSuspect,
      warnings: routed.warnings,
    };
  } catch (err) {
    logger.error({ sourceId, contentHash, err: serializeErr(err) }, "ingestion failed");

    if (sourceId) {
      await deleteChunksForSource(sourceId).catch(() => {});
      await prisma.source
        .update({ where: { id: sourceId }, data: { status: "failed", error: errorMessage(err) } })
        .catch(() => {});
    }

    if (err instanceof IngestionError && !err.retryable) {
      throw new UnrecoverableError(err.message);
    }
    if (err instanceof RefusalError) {
      throw new UnrecoverableError(`Model declined to process this file: ${err.message}`);
    }
    throw err;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function serializeErr(err: unknown) {
  return { message: errorMessage(err), name: err instanceof Error ? err.name : undefined };
}
