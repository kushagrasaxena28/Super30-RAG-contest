import { detectHeadingLines } from "../textUtils.js";
import type { ChunkerContext, PendingChunk } from "../types.js";

/**
 * Splits on generic heading-shaped lines (see textUtils.detectHeadingLines).
 * Header is prepended to each chunk's body so a chunk retrieved alone still
 * says what section it's from.
 */
export function chunkNamedSections(text: string, ctx: ChunkerContext): PendingChunk[] {
  const lines = text.split("\n");
  const headings = detectHeadingLines(text);
  if (headings.length === 0) {
    return [
      {
        text: text.trim(),
        metadata: { sourceType: ctx.sourceType, clientId: ctx.clientId, sessionDate: ctx.sessionDate, isSummary: false },
      },
    ];
  }

  const chunks: PendingChunk[] = [];

  // Anything before the first heading (title/intro material) becomes its
  // own chunk if it has real content.
  const preamble = lines.slice(0, headings[0]!.index).join("\n").trim();
  if (preamble.length > 20) {
    chunks.push({
      text: preamble,
      metadata: { sourceType: ctx.sourceType, clientId: ctx.clientId, sessionDate: ctx.sessionDate, isSummary: false },
    });
  }

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    const end = i + 1 < headings.length ? headings[i + 1]!.index : lines.length;
    const body = lines.slice(heading.index + 1, end).join("\n").trim();
    chunks.push({
      text: `${heading.text}\n\n${body}`.trim(),
      metadata: {
        sourceType: ctx.sourceType,
        clientId: ctx.clientId,
        sessionDate: ctx.sessionDate,
        categoryOrSection: heading.text,
        isSummary: false,
      },
    });
  }

  return chunks;
}
