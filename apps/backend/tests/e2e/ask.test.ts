import { beforeAll, describe, expect, test } from "bun:test";
import { ask, getConversation, type AskSource, type SourceRow } from "../helpers/api.js";
import { announceSkip, probeE2e } from "../helpers/preconditions.js";
import { ASK_TIMEOUT_MS } from "../helpers/config.js";

/**
 * Real, billable Anthropic calls. Opt in with RUN_E2E=1 (`bun run test:e2e`).
 * Also needs a populated index - see tests/README.md.
 */

const probe = await probeE2e();
announceSkip("e2e/ask", probe);

let knownClients: Set<string>;
let knownLabels: Set<string>;

/** citations.ts assembles every label from database rows: a transcript label
 * is "<client> — Transcript N (date)", anything else is the source filename
 * without its extension. So a source that resolves to a real chunk always
 * traces back to a row in GET /api/sources. */
function assertSourcesAreReal(sources: AskSource[]) {
  expect(sources.length).toBeGreaterThan(0);
  for (const s of sources) {
    expect(s.chunkId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(s.label.length).toBeGreaterThan(0);
    expect(s.excerpt.length).toBeGreaterThan(0);
    expect(["transcript", "reference_document"]).toContain(s.sourceType);

    if (s.clientName) {
      expect([...knownClients], `source cites unknown client "${s.clientName}"`).toContain(s.clientName);
    }
    if (s.sourceType === "transcript") {
      expect(s.label).toMatch(/^.+ — Transcript( \d+)?( \(\d{4}-\d{2}-\d{2}\))?$/);
    } else {
      expect([...knownLabels], `label "${s.label}" matches no indexed source filename`).toContain(s.label);
    }
  }
}

function stripExt(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i > 0 ? filename.slice(0, i) : filename;
}

describe.skipIf(!probe.ok)("POST /api/ask", () => {
  beforeAll(() => {
    const ready: SourceRow[] = probe.sources;
    knownClients = new Set(ready.map((s) => s.clientName).filter((n): n is string => Boolean(n)));
    knownLabels = new Set(ready.map((s) => stripExt(s.filename)));
  });

  test(
    "happy path: grounded answer, real sources, sufficientEvidence true",
    async () => {
      const res = await ask("When should a client submit a grievance?");

      expect(res.answer.trim().length).toBeGreaterThan(0);
      expect(res.conversationId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(res.sufficientEvidence).toBe(true);
      assertSourcesAreReal(res.sources);
      expect(res.sources.some((s) => /grievance/i.test(s.label))).toBe(true);
      // The 24-hour deadline is the substance of the Timeline section.
      expect(res.answer).toMatch(/24|twenty-four/i);

      // The turn is persisted with the same sources the caller was handed.
      const convo = await getConversation(res.conversationId);
      const assistant = convo.messages.find((m) => m.id === res.messageId);
      expect(assistant?.role).toBe("assistant");
      expect(assistant?.sources?.map((s) => s.chunkId)).toEqual(res.sources.map((s) => s.chunkId));
    },
    ASK_TIMEOUT_MS,
  );

  test(
    "negative: \"What is Robert's blood type?\" -> sufficientEvidence false, nothing invented",
    async () => {
      const res = await ask("What is Robert's blood type?");

      expect(res.sufficientEvidence).toBe(false);
      // No blood type may appear anywhere in the answer.
      expect(res.answer).not.toMatch(/\b(?:A|B|AB|O)\s*(?:\+|-|positive|negative)\b/i);
      expect(res.answer).not.toMatch(/\btype\s+(?:A|B|AB|O)\b/i);
      // It should say so rather than pad with generalities.
      expect(res.answer).toMatch(/not|no |n't|unable|isn't|does not|doesn't/i);
      if (res.sources.length > 0) assertSourcesAreReal(res.sources);
    },
    ASK_TIMEOUT_MS,
  );

  test(
    "ambiguity: a question naming no client states which session it used",
    async () => {
      const res = await ask("Did the case manager follow all the check-in guidelines?");

      expect(res.assumptions.length).toBeGreaterThan(0);
      const stated = res.assumptions.join(" ");
      // The assumption must name the session it picked - a client, a date,
      // or an explicit "most recent session", not just "I assumed things".
      expect(stated).toMatch(/nathan|robert|\d{4}-\d{2}-\d{2}|most recent|latest|session|transcript|meeting/i);
      if (res.sources.length > 0) assertSourcesAreReal(res.sources);
    },
    ASK_TIMEOUT_MS,
  );
});

describe.skipIf(!probe.ok)("multi-turn conversation", () => {
  let conversationId: string;

  beforeAll(() => {
    knownClients = new Set(probe.sources.map((s) => s.clientName).filter((n): n is string => Boolean(n)));
    knownLabels = new Set(probe.sources.map((s) => stripExt(s.filename)));
  });

  test(
    "turn 1 establishes Nathan as the subject",
    async () => {
      const res = await ask("Tell me about Nathan's family situation");
      conversationId = res.conversationId;
      expect(conversationId).toBeTruthy();
      expect(res.sources.some((s) => s.clientName === "Nathan")).toBe(true);
    },
    ASK_TIMEOUT_MS,
  );

  test(
    "turn 2: \"what about his employment?\" stays on Nathan without the name being repeated",
    async () => {
      const turn2 = await ask("what about his employment?", conversationId);

      expect(turn2.conversationId).toBe(conversationId);
      // The real proof the pronoun resolved: retrieval pulled Nathan's
      // material for a question that never says "Nathan".
      const nathanSources = turn2.sources.filter((s) => s.clientName === "Nathan");
      expect(nathanSources.length).toBeGreaterThan(0);
      expect(turn2.sources.some((s) => s.clientName === "Robert")).toBe(false);
      expect(turn2.answer).toMatch(/job|work|employ|hour|wage|shift/i);
    },
    ASK_TIMEOUT_MS,
  );

  test(
    "turn 3: an explicitly general question must NOT stay Nathan-scoped (plan/07 over-reach guard)",
    async () => {
      const turn3 = await ask("actually, when can anyone file a grievance?", conversationId);

      expect(turn3.conversationId).toBe(conversationId);
      expect(turn3.sources.some((s) => /grievance/i.test(s.label))).toBe(true);
      // Query rewriting must not inject the dominant entity into a
      // genuinely new, general question.
      const leaked = turn3.sources.filter((s) => s.clientName === "Nathan");
      expect(leaked.map((s) => s.label)).toEqual([]);
      expect(turn3.answer).not.toMatch(/\bNathan\b/);
    },
    ASK_TIMEOUT_MS,
  );
});
