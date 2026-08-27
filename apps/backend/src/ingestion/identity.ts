import path from "node:path";

export interface ParsedIdentity {
  clientName: string | null;
  sessionDate: string | null; // ISO date (YYYY-MM-DD)
}

// Bundled dataset follows `name-MM-DD.pdf` (e.g. "nathan-06-02.pdf"), but is
// inconsistent about zero-padding ("robert-5-21.pdf" drops the leading
// zero on both month and day) - the regex must tolerate both. Uploaded
// files are not expected to follow this convention at all; the caller
// falls back to content-derived identity (see plan/02-ingestion.md).
const FILENAME_PATTERN = /^([a-zA-Z]+)-(\d{1,2})-(\d{1,2})/;

// The bundled dataset's filenames carry no year - every observed session
// falls in 2025. This is a best-effort default for filename-only parsing,
// not a general assumption; content-derived dates (from the labeling call,
// or a filename that does include a year) always take precedence when
// available. Documented as a known limitation in the README.
const DEFAULT_YEAR = 2025;

export function parseIdentityFromFilename(originalName: string): ParsedIdentity {
  const base = path.basename(originalName, path.extname(originalName));
  const match = base.match(FILENAME_PATTERN);
  if (!match) return { clientName: null, sessionDate: null };

  // Capture groups are guaranteed present once `match` succeeds (the regex
  // has exactly 3 groups, none optional) - TS's strict indexed-access
  // typing doesn't know that statically.
  const name = match[1]!;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { clientName: capitalize(name), sessionDate: null };
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return { clientName: capitalize(name), sessionDate: `${DEFAULT_YEAR}-${mm}-${dd}` };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
