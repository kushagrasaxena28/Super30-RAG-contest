import { beforeAll, describe, expect, test } from "bun:test";
import {
  debugRetrieval,
  describeCandidate,
  indexSourcesById,
  type DebugCandidate,
  type DebugRetrievalPayload,
  type SourceRow,
} from "../helpers/api.js";
import { announceSkip, probeIndex } from "../helpers/preconditions.js";
import { RETRIEVAL_TIMEOUT_MS } from "../helpers/config.js";
import { RETRIEVAL_CANDIDATE_LIMIT } from "../../src/config/constants.js";

/**
 * The retrieval table from plan/10-verification.md, driven through
 * POST /api/debug/retrieval - no generation calls, so this layer is cheap
 * (one low-effort analysis call + one embedding per question).
 *
 * Requires Postgres + Qdrant + Redis AND a populated index. Skips with an
 * explanation when either is missing (see tests/README.md).
 */

const probe = await probeIndex();
announceSkip("integration/retrieval", probe);

const QUESTIONS = {
  grievance: "When should a client submit a grievance?",
  standard: "What is CD-080?",
  robertThemes: "What are key themes Robert talks about?",
  nathanPrinciple: "Did the CM use the 2nd principle in Nathan's last meeting?",
  nathanFamily: "What is Nathan's relationship with his family like?",
} as const;

type QuestionKey = keyof typeof QUESTIONS;

const results = new Map<QuestionKey, DebugRetrievalPayload>();
let byId: Map<string, SourceRow>;

/** Candidates joined to their Source row, for readable assertions. */
function joined(key: QuestionKey): Array<{ candidate: DebugCandidate; source: SourceRow | undefined }> {
  return results.get(key)!.candidates.map((candidate) => ({ candidate, source: byId.get(candidate.sourceId) }));
}

function dump(key: QuestionKey): string {
  const r = results.get(key)!;
  const lines = r.candidates.map((c, i) => `    ${i + 1}. ${describeCandidate(c, byId)}`);
  return [
    `  question: ${QUESTIONS[key]}`,
    `  analysis: ${JSON.stringify(r.analysis)}`,
    `  resolvedClientId=${r.resolvedClientId} resolvedSessionDate=${r.resolvedSessionDate}`,
    `  candidates (${r.candidates.length}):`,
    ...lines,
  ].join("\n");
}

describe.skipIf(!probe.ok)("retrieval (plan/10 table)", () => {
  beforeAll(async () => {
    byId = indexSourcesById(probe.sources);
    // Run every question once and share the results - each one costs an
    // analysis call, and six tests should not mean six times the spend.
    for (const [key, question] of Object.entries(QUESTIONS) as Array<[QuestionKey, string]>) {
      results.set(key, await debugRetrieval(question));
    }
  }, RETRIEVAL_TIMEOUT_MS * Object.keys(QUESTIONS).length);

  test("'When should a client submit a grievance?' -> grievance doc, Timeline section, top-ranked", () => {
    const rows = joined("grievance");
    expect(rows.length).toBeGreaterThan(0);

    const top = rows[0]!;
    if (!top.source || !/grievance/i.test(top.source.filename)) console.error(dump("grievance"));
    expect(top.source?.filename).toMatch(/grievance/i);

    const section = top.candidate.metadata?.categoryOrSection ?? "";
    if (!/timeline/i.test(section)) console.error(dump("grievance"));
    expect(section).toMatch(/timeline/i);
  });

  test("'What is CD-080?' -> that exact standard chunk (the sparse leg is pulling weight)", () => {
    const rows = joined("standard");
    const hit = rows.find((r) => r.candidate.metadata?.standardCode === "CD-080");

    if (!hit) console.error(dump("standard"));
    expect(hit, "no candidate carried standardCode CD-080").toBeDefined();

    // A verbatim code is exactly the case dense retrieval blurs - if the
    // FTS leg is dead this chunk arrives with sparseRank null, or not at all.
    if (hit!.candidate.sparseRank === null) console.error(dump("standard"));
    expect(hit!.candidate.sparseRank).not.toBeNull();
  });

  test("'What are key themes Robert talks about?' -> Robert summaries, no Nathan chunks", () => {
    const rows = joined("robertThemes");

    const robertSummaries = rows.filter((r) => r.source?.clientName === "Robert" && r.candidate.metadata?.isSummary);
    const nathanChunks = rows.filter((r) => r.source?.clientName === "Nathan");

    if (robertSummaries.length === 0 || nathanChunks.length > 0) console.error(dump("robertThemes"));
    expect(robertSummaries.length).toBeGreaterThan(0);
    expect(nathanChunks.map((r) => r.source!.filename)).toEqual([]);
  });

  test("'Did the CM use the 2nd principle in Nathan's last meeting?' -> 8-Principles doc AND nathan-06-02 chunks", () => {
    const r = results.get("nathanPrinciple")!;
    const rows = joined("nathanPrinciple");

    const principlesDoc = rows.some((row) => /principles/i.test(row.source?.filename ?? ""));
    const nathanLastSession = rows.some((row) => /nathan-0?6-0?2/i.test(row.source?.filename ?? ""));

    // This single question exercises four mechanisms at once. When it
    // fails, say WHICH one broke rather than just "expected true".
    const clientResolved = r.resolvedClientId !== null && /nathan/i.test(r.analysis.clientName ?? "");
    const temporalResolved = r.resolvedSessionDate === "2025-06-02";
    const decomposed = r.analysis.queryType === "multi_hop" && r.analysis.subQueries.length > 1;

    if (!principlesDoc || !nathanLastSession) {
      console.error(
        [
          "",
          "  Diagnosis - four mechanisms feed this one question:",
          `    1. client resolution   : ${clientResolved ? "OK" : "BROKEN"} (analysis.clientName=${JSON.stringify(r.analysis.clientName)}, resolvedClientId=${r.resolvedClientId})`,
          `    2. MAX(sessionDate)    : ${temporalResolved ? "OK" : "BROKEN"} (temporalRef=${JSON.stringify(r.analysis.temporalRef)}, resolvedSessionDate=${r.resolvedSessionDate}, expected 2025-06-02)`,
          `    3. multi-hop decompose : ${decomposed ? "OK" : "BROKEN"} (queryType=${r.analysis.queryType}, subQueries=${JSON.stringify(r.analysis.subQueries)})`,
          `    4. cross-origin union  : principlesDoc=${principlesDoc}, nathan-06-02=${nathanLastSession}`,
          "",
          dump("nathanPrinciple"),
        ].join("\n"),
      );
    }

    expect({ principlesDoc, nathanLastSession }).toEqual({ principlesDoc: true, nathanLastSession: true });
  });

  test("'What is Nathan's relationship with his family like?' -> Nathan chunks across multiple sessions", () => {
    const rows = joined("nathanFamily");
    const nathanSources = new Set(
      rows.filter((r) => r.source?.sourceType === "transcript" && r.source.clientName === "Nathan").map((r) => r.source!.id),
    );

    if (nathanSources.size < 2) console.error(dump("nathanFamily"));
    expect(nathanSources.size).toBeGreaterThanOrEqual(2);
  });

  test(`no query returns more than the candidate budget (${RETRIEVAL_CANDIDATE_LIMIT})`, () => {
    for (const key of Object.keys(QUESTIONS) as QuestionKey[]) {
      const n = results.get(key)!.candidates.length;
      if (n > RETRIEVAL_CANDIDATE_LIMIT) console.error(dump(key));
      expect(n).toBeLessThanOrEqual(RETRIEVAL_CANDIDATE_LIMIT);
    }
  });

  test("every candidate is a real chunk with a real source and a scored provenance", () => {
    for (const key of Object.keys(QUESTIONS) as QuestionKey[]) {
      for (const { candidate, source } of joined(key)) {
        if (candidate.metadata?.isSummary) {
          expect(candidate.excerpt.length).toBeGreaterThan(0);
          expect(candidate.fusedScore).toBeGreaterThan(0);
          continue;
        }
        expect(source, `candidate ${candidate.chunkId} references unknown source ${candidate.sourceId}`).toBeDefined();
        expect(source!.status).toBe("ready");
        expect(candidate.excerpt.length).toBeGreaterThan(0);
        expect(candidate.fusedScore).toBeGreaterThan(0);
        // At least one leg must have found it - a candidate in neither is
        // an impossible row.
        expect(candidate.denseRank !== null || candidate.sparseRank !== null).toBe(true);
      }
    }
  });

  test("retrieval is query-dependent, not a fixed top-N", () => {
    const grievance = new Set(results.get("grievance")!.candidates.map((c) => c.chunkId));
    const robert = results.get("robertThemes")!.candidates.map((c) => c.chunkId);
    const overlap = robert.filter((id) => grievance.has(id));
    expect(overlap.length).toBeLessThan(robert.length);
  });
});
