import { hybridSearch, type Candidate } from "../hybridSearch.js";
import { DEFAULT_HYBRID_K } from "../../config/constants.js";

export interface MultiHopParams {
  clientId?: string;
  sessionDate?: string;
}

/**
 * Retrieve per sub-query in parallel, union, dedupe by chunk id, keep best
 * fused rank. This is what pulls a doc chunk *and* a transcript chunk for
 * "did the CM use principle 2 in the last meeting" - the transcript chunk
 * shares almost no vocabulary with the question, so only decomposition
 * finds it (see plan/05-retrieval.md).
 */
export async function multiHopStrategy(subQueries: string[], params: MultiHopParams): Promise<Candidate[]> {
  const results = await Promise.all(
    subQueries.map((q) => {
      // In multi-hop decomposition, some sub-queries ask about general policy / standards
      // while others ask about specific client sessions or transcripts. Filtering all
      // sub-queries by clientId eliminates policy documents (which have clientId = null).
      const isClientSpecific =
        Boolean(params.clientId) &&
        /transcript|session|meeting|interview|client|talk|behavior|record/i.test(q);

      return hybridSearch(
        q,
        DEFAULT_HYBRID_K,
        isClientSpecific ? { clientId: params.clientId, sessionDate: params.sessionDate } : {},
      );
    }),
  );

  const best = new Map<string, Candidate>();
  for (const list of results) {
    for (const c of list) {
      const existing = best.get(c.chunkId);
      if (!existing || c.fusedScore > existing.fusedScore) best.set(c.chunkId, c);
    }
  }
  return [...best.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}

/**
 * Comparison is multi-hop with one sub-query per compared item, forcing
 * representation from each side so one item can't dominate the candidate
 * set (see plan/05-retrieval.md).
 */
export async function comparisonStrategy(subQueries: string[], params: MultiHopParams): Promise<Candidate[]> {
  const perItemK = Math.max(4, Math.floor(DEFAULT_HYBRID_K / Math.max(subQueries.length, 1)) + 3);
  const results = await Promise.all(
    subQueries.map((q) => hybridSearch(q, perItemK, { clientId: params.clientId, sessionDate: params.sessionDate })),
  );

  const seen = new Set<string>();
  const merged: Candidate[] = [];
  // Round-robin across sub-query result lists so one side can't dominate.
  const maxLen = Math.max(...results.map((r) => r.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const list of results) {
      const c = list[i];
      if (!c || seen.has(c.chunkId)) continue;
      seen.add(c.chunkId);
      merged.push(c);
    }
  }
  return merged;
}
