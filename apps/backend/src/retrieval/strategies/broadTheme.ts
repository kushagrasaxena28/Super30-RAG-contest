import { hybridSearch, type Candidate } from "../hybridSearch.js";
import { BROAD_THEME_DETAIL_K } from "../../config/constants.js";

export interface BroadThemeParams {
  clientId?: string;
}

/**
 * Summary chunks for the entity first, plus bounded top-k detail chunks for
 * quotable specifics - never "all chunks for this client", which is what
 * breaks at 100 clients (see plan/05-retrieval.md).
 */
export async function broadThemeStrategy(query: string, params: BroadThemeParams): Promise<Candidate[]> {
  const [summaries, details] = await Promise.all([
    hybridSearch(query, 5, { clientId: params.clientId, onlySummaries: true }),
    hybridSearch(query, BROAD_THEME_DETAIL_K, { clientId: params.clientId, excludeSummaries: true }),
  ]);

  const seen = new Set<string>();
  const merged: Candidate[] = [];
  for (const c of [...summaries, ...details]) {
    if (seen.has(c.chunkId)) continue;
    seen.add(c.chunkId);
    merged.push(c);
  }
  return merged;
}
