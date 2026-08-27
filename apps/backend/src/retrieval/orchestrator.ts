import { analyzeQuery, type ConversationTurn, type QueryAnalysis } from "./queryAnalysis.js";
import { findClientByName } from "./clientResolver.js";
import { resolveTemporalSessionDate } from "./temporal.js";
import { hybridSearch, type Candidate } from "./hybridSearch.js";
import { factoidStrategy } from "./strategies/factoid.js";
import { broadThemeStrategy } from "./strategies/broadTheme.js";
import { multiHopStrategy, comparisonStrategy } from "./strategies/multiHop.js";
import { RETRIEVAL_CANDIDATE_LIMIT } from "../config/constants.js";

export interface RetrievalResult {
  analysis: QueryAnalysis;
  candidates: Candidate[];
  clientId?: string;
  sessionDate?: string;
  analysisMs: number;
  retrievalMs: number;
}

export interface RetrieveOptions {
  /** Bounded single retry on insufficient evidence (see plan/06-generation.md):
   * drop the entity filter, widen k, include summaries. */
  widen?: boolean;
}

/**
 * Dispatch + dedupe + budget. Given a question (and conversation context),
 * returns a small, bounded, well-chosen candidate set - never a blanket
 * "fetch everything" (see plan/05-retrieval.md). Final budget is always
 * ~15 candidates regardless of strategy or how wide the search went.
 */
export async function retrieve(
  question: string,
  recentTurns: ConversationTurn[],
  opts: RetrieveOptions = {},
): Promise<RetrievalResult> {
  const analysisStart = Date.now();
  const analysis = await analyzeQuery(question, recentTurns);
  const analysisMs = Date.now() - analysisStart;

  const retrievalStart = Date.now();

  let clientId: string | undefined;
  if (analysis.clientName) {
    const client = await findClientByName(analysis.clientName);
    clientId = client?.id;
  }

  let sessionDate: string | undefined;
  if (clientId && analysis.temporalRef && analysis.temporalRef !== "all") {
    const date = await resolveTemporalSessionDate(clientId, analysis.temporalRef);
    sessionDate = date?.toISOString().slice(0, 10);
  }

  const subQueries = analysis.subQueries.length > 0 ? analysis.subQueries : [analysis.rewrittenQuery];

  let candidates: Candidate[];
  switch (analysis.queryType) {
    case "broad_theme":
      candidates = await broadThemeStrategy(analysis.rewrittenQuery, { clientId });
      break;
    case "multi_hop":
      candidates = await multiHopStrategy(subQueries, { clientId, sessionDate });
      break;
    case "comparison":
      candidates = await comparisonStrategy(subQueries, { clientId, sessionDate });
      break;
    case "factoid":
    default:
      candidates = await factoidStrategy(analysis.rewrittenQuery, { clientId, sessionDate });
      break;
  }

  if (opts.widen) {
    const widened = await hybridSearch(analysis.rewrittenQuery, 20, {});
    const seen = new Set(candidates.map((c) => c.chunkId));
    for (const c of widened) {
      if (seen.has(c.chunkId)) continue;
      seen.add(c.chunkId);
      candidates.push(c);
    }
  }

  candidates.sort((a, b) => b.fusedScore - a.fusedScore);
  candidates = candidates.slice(0, RETRIEVAL_CANDIDATE_LIMIT);

  return { analysis, candidates, clientId, sessionDate, analysisMs, retrievalMs: Date.now() - retrievalStart };
}
