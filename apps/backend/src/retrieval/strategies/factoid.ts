import { hybridSearch, type Candidate } from "../hybridSearch.js";
import { DEFAULT_HYBRID_K } from "../../config/constants.js";

export interface FactoidParams {
  clientId?: string;
  sessionDate?: string;
}

/** Hybrid, k~8, entity filter if resolved, summaries excluded (specifics, not summaries) - see plan/05-retrieval.md. */
export async function factoidStrategy(query: string, params: FactoidParams): Promise<Candidate[]> {
  return hybridSearch(query, DEFAULT_HYBRID_K, {
    clientId: params.clientId,
    sessionDate: params.sessionDate,
    excludeSummaries: true,
  });
}
