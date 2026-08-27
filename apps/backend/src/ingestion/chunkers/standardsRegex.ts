import type { ChunkerContext, PendingChunk } from "../types.js";

const STANDARD_HEADING = /^([A-Z]{2,4}-\d{3}):\s*(.*)$/;
const CATEGORY_BREADCRUMB = /^[A-Za-z][\w/ ]{2,60}\([A-Z]{2,6}\)\s*$/;

export function countStandardsHeadings(text: string): number {
  return text.split("\n").filter((l) => STANDARD_HEADING.test(l.trim())).length;
}

/**
 * One chunk per standard code (e.g. "CS-010: Random Headcounts..."),
 * category breadcrumb prepended (e.g. "Client Supervision (CS)") so a
 * chunk retrieved alone still says what it is. Caller is expected to have
 * already run stripPageFurniture() on the text - this chunker does not
 * re-detect furniture, it only knows about standard-code headings and
 * category breadcrumbs.
 */
export function chunkStandardsRegex(text: string, ctx: ChunkerContext): PendingChunk[] {
  const lines = text.split("\n");
  const chunks: PendingChunk[] = [];

  // `currentBreadcrumb` is the most recent breadcrumb *seen*; `chunkBreadcrumb`
  // is the one in effect when the standard being accumulated started. They
  // differ for the last standard of each category, whose chunk is still
  // pending when the next category's breadcrumb line arrives - reading
  // `currentBreadcrumb` at flush time filed that standard under the *next*
  // category, in both the metadata and the embedded header text.
  let currentBreadcrumb: string | null = null;
  let chunkBreadcrumb: string | null = null;
  let currentCode: string | null = null;
  let currentTitle = "";
  let currentBody: string[] = [];

  const flush = () => {
    if (!currentCode) return;
    const header = chunkBreadcrumb
      ? `${chunkBreadcrumb} — ${currentCode}: ${currentTitle}`
      : `${currentCode}: ${currentTitle}`;
    const body = currentBody.join("\n").trim();
    chunks.push({
      text: `${header}\n\n${body}`.trim(),
      metadata: {
        sourceType: ctx.sourceType,
        clientId: ctx.clientId,
        sessionDate: ctx.sessionDate,
        standardCode: currentCode,
        categoryOrSection: chunkBreadcrumb ?? undefined,
        isSummary: false,
      },
    });
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const headingMatch = trimmed.match(STANDARD_HEADING);
    if (headingMatch) {
      flush();
      chunkBreadcrumb = currentBreadcrumb;
      currentCode = headingMatch[1]!;
      currentTitle = headingMatch[2]!.trim();
      currentBody = [];
      continue;
    }

    if (CATEGORY_BREADCRUMB.test(trimmed)) {
      currentBreadcrumb = trimmed;
      continue;
    }

    if (currentCode) currentBody.push(rawLine);
  }
  flush();

  return chunks;
}
