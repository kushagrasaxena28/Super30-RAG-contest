import { WHOLE_DOC_WORD_THRESHOLD } from "../config/constants.js";
import { detectHeadingLines, wordCount } from "./textUtils.js";
import { countStandardsHeadings } from "./chunkers/standardsRegex.js";

export type ChunkStrategy = "wholeDoc" | "standardsRegex" | "namedSections" | "llmSegment";

export const MIN_HEADING_MATCHES = 3;

/**
 * The structure-first routing decision for reference documents (see
 * plan/02-ingestion.md), extracted from router.ts as a pure function so it
 * can be unit-tested without pulling in the LLM-backed chunkers:
 *
 *   1. wordCount < 400            -> wholeDoc
 *   2. >=3 standard-code headings -> standardsRegex
 *   3. >=3 heading-shaped lines   -> namedSections
 *   4. otherwise                  -> llmSegment
 *
 * Expects text that has already been through stripPageFurniture().
 */
export function selectChunkStrategy(cleanedText: string): ChunkStrategy {
  if (wordCount(cleanedText) < WHOLE_DOC_WORD_THRESHOLD) return "wholeDoc";
  if (countStandardsHeadings(cleanedText) >= MIN_HEADING_MATCHES) return "standardsRegex";
  if (detectHeadingLines(cleanedText).length >= MIN_HEADING_MATCHES) return "namedSections";
  return "llmSegment";
}
