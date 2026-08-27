import { stripPageFurniture } from "./textUtils.js";
import { selectChunkStrategy } from "./strategySelect.js";
import { chunkStandardsRegex } from "./chunkers/standardsRegex.js";
import { chunkNamedSections } from "./chunkers/namedSections.js";
import { chunkLlmSegment } from "./chunkers/llmSegment.js";
import { chunkWholeDoc } from "./chunkers/wholeDoc.js";
import { labelAndChunkTranscript } from "./chunkers/transcriptTurns.js";
import type { ChunkerContext, PendingChunk } from "./types.js";
import type { SourceTypeValue } from "../types/domain.js";

export interface RoutedResult {
  chunks: PendingChunk[];
  labelingSuspect: boolean;
  warnings: string[];
  clientNameFromContent: string | null;
  sessionDateFromContent: string | null;
  strategy: string;
}

/**
 * Structure-first routing, LLM only as fallback (see plan/02-ingestion.md).
 * The decision itself lives in strategySelect.ts (pure, unit-tested); this
 * function just runs the chosen chunker.
 * Transcripts always go through speaker labeling + turn windowing instead.
 */
export async function routeAndChunk(
  rawText: string,
  sourceType: SourceTypeValue,
  ctx: Omit<ChunkerContext, "sourceType">,
): Promise<RoutedResult> {
  if (sourceType === "transcript") {
    const result = await labelAndChunkTranscript(rawText, { ...ctx, sourceType });
    return {
      chunks: result.chunks,
      labelingSuspect: result.labelingSuspect,
      warnings: result.warnings,
      clientNameFromContent: result.clientName,
      sessionDateFromContent: result.sessionDate,
      strategy: "transcriptTurns",
    };
  }

  const cleaned = stripPageFurniture(rawText);
  const fullCtx: ChunkerContext = { ...ctx, sourceType };

  const strategy = selectChunkStrategy(cleaned);

  const chunks =
    strategy === "wholeDoc"
      ? chunkWholeDoc(cleaned, fullCtx)
      : strategy === "standardsRegex"
        ? chunkStandardsRegex(cleaned, fullCtx)
        : strategy === "namedSections"
          ? chunkNamedSections(cleaned, fullCtx)
          : await chunkLlmSegment(cleaned, fullCtx);

  return {
    chunks,
    labelingSuspect: false,
    warnings: [],
    clientNameFromContent: null,
    sessionDateFromContent: null,
    strategy,
  };
}
