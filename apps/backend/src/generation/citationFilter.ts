/**
 * The anti-fabricated-citation guarantee, as two pure functions (see
 * plan/06-generation.md: "Ids are validated against the supplied candidate
 * set; anything unrecognized is dropped").
 *
 * Kept free of Prisma so the guarantee is unit-testable without a database
 * - it is the single most important invariant in the generation path.
 */

/** Keep only ids the model was actually shown. Order and duplicates preserved. */
export function filterCitedIds(citedChunkIds: readonly string[], candidateIds: Iterable<string>): string[] {
  const valid = new Set(candidateIds);
  return citedChunkIds.filter((id) => valid.has(id));
}

/**
 * Reorder `rows` into the order the ids were cited in, dropping any id with
 * no matching row. An id that resolves to nothing is never rendered - it is
 * silently discarded rather than turned into a plausible-looking source.
 */
export function orderAndDropUnknown<T>(
  ids: readonly string[],
  rows: readonly T[],
  keyOf: (row: T) => string,
): T[] {
  const byId = new Map(rows.map((r) => [keyOf(r), r]));
  const ordered: T[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row === undefined) continue; // not in the supplied candidate set - dropped, never trusted
    ordered.push(row);
  }
  return ordered;
}
