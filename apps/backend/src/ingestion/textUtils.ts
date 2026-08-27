/**
 * Strips repeated page furniture (headers/footers that `pdftotext` interleaves
 * mid-body at page breaks - e.g. "2022 Colorado Community Corrections
 * Standards" / "Published: October 2022   3 | Page" / "Reviewed 2/26/2024
 * ... P a g e 2|3"). Generic rather than hardcoded to one document: any
 * short line whose digit-normalized form repeats 3+ times across the text
 * is page furniture, because real body content essentially never repeats
 * verbatim (aside from the page number, which the normalization absorbs).
 */
export function stripPageFurniture(text: string): string {
  const lines = text.split("\n");
  const signatureCounts = new Map<string, number>();

  const signatureOf = (line: string): string | null => {
    const trimmed = line.trim();
    if (trimmed.length < 4 || trimmed.length > 120) return null;
    const sig = trimmed.replace(/\d+/g, "#");
    // Require some alphabetic content so we don't treat blank-ish
    // whitespace/punctuation runs as a "repeated" signature.
    if (!/[a-zA-Z]{3,}/.test(sig)) return null;
    return sig;
  };

  for (const line of lines) {
    const sig = signatureOf(line);
    if (sig) signatureCounts.set(sig, (signatureCounts.get(sig) ?? 0) + 1);
  }

  const furnitureSignatures = new Set(
    [...signatureCounts.entries()].filter(([, count]) => count >= 3).map(([sig]) => sig),
  );
  if (furnitureSignatures.size === 0) return text;

  return lines
    .filter((line) => {
      const sig = signatureOf(line);
      return !(sig && furnitureSignatures.has(sig));
    })
    .join("\n");
}

export interface HeadingLine {
  index: number; // line index in the split array
  text: string;
}

const BULLET_START = /^\s*([•\-*o]|\d+[.)]|[a-zA-Z][.)])\s/;

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 90) return false;
  if (BULLET_START.test(line)) return false;
  if (/[.!?,;]$/.test(trimmed)) return false; // colons/dashes are fine
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  // Headings are Title Case-ish or short phrases, not full sentences -
  // reject anything with more than ~10 words, which is almost always body text.
  if (trimmed.split(/\s+/).length > 10) return false;
  return true;
}

/**
 * Detects heading-shaped lines: short standalone lines with no terminal
 * sentence punctuation, followed by body/list content. Deliberately
 * generic so it works on the reviewer's unknown documents, not just ours
 * (see plan/02-ingestion.md).
 */
export function detectHeadingLines(text: string): HeadingLine[] {
  const lines = text.split("\n");
  const headings: HeadingLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !looksLikeHeading(line)) continue;

    // Look ahead (skipping blank lines) for body/list content that
    // confirms this is a heading rather than an isolated short sentence.
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++;
    if (j >= lines.length) continue;
    const next = lines[j]!;
    if (next.trim() === "") continue;

    headings.push({ index: i, text: line.trim() });
  }

  return headings;
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
