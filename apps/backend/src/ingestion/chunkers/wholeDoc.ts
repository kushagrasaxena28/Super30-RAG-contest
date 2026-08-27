import type { ChunkerContext, PendingChunk } from "../types.js";

/** No-split fast path for short documents - splitting would break questions
 * that need the whole thing at once (e.g. "did the CM follow *all* the
 * check-in guidelines" needs all 11 items in one chunk). */
export function chunkWholeDoc(text: string, ctx: ChunkerContext): PendingChunk[] {
  return [
    {
      text: text.trim(),
      metadata: {
        sourceType: ctx.sourceType,
        clientId: ctx.clientId,
        sessionDate: ctx.sessionDate,
        isSummary: false,
      },
    },
  ];
}
