import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { structuredCall } from "../llm/index.js";
import { listClientNames } from "./clientResolver.js";

export const QueryAnalysisSchema = z.object({
  queryType: z.enum(["factoid", "broad_theme", "multi_hop", "comparison"]),
  clientName: z.string().nullable(),
  temporalRef: z.enum(["last", "first", "all"]).nullable(),
  subQueries: z.array(z.string()),
  rewrittenQuery: z.string(),
});

export type QueryAnalysis = z.infer<typeof QueryAnalysisSchema>;

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * One Claude call (effort: low) that both classifies the question shape and
 * resolves it against conversation context (see plan/05-retrieval.md).
 * `rewrittenQuery` is what retrieval actually searches on - never the raw,
 * possibly pronoun-laden question - so a follow-up like "what about his
 * family?" becomes standalone before it reaches hybrid search.
 */
export async function analyzeQuery(question: string, recentTurns: ConversationTurn[]): Promise<QueryAnalysis> {
  const knownClients = await listClientNames();

  const historyBlock =
    recentTurns.length > 0
      ? recentTurns.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n")
      : "(none - this is the first message in the conversation)";

  return structuredCall({
    label: "retrieval.queryAnalysis",
    effort: "low",
    schema: QueryAnalysisSchema,
    system: [
      {
        type: "text",
        text: [
          "You analyze questions for a RAG system over case-management transcripts",
          "and policy documents, to decide how to retrieve evidence.",
          "",
          `Known clients: ${knownClients.length > 0 ? knownClients.join(", ") : "(none yet)"}`,
          "",
          "queryType:",
          "- factoid: asks for a specific fact (a date, a status, a rule).",
          "- broad_theme: asks about overall themes/patterns/summary for an entity.",
          "- multi_hop: needs evidence from more than one kind of source to answer",
          "  (e.g. a policy definition AND a transcript behavior).",
          "- comparison: compares two or more named things (clients, sessions, standards).",
          "",
          "clientName: match against the known-clients list above, case-insensitively.",
          "Return null if the question does not concern a specific client - do NOT",
          "carry a client over from prior turns unless the current question is",
          "actually about them (e.g. 'when should anyone file a grievance?' is",
          "general even mid-conversation about a specific client).",
          "",
          "temporalRef: 'last'/'first'/'all' if the question refers to a specific",
          "session by recency (e.g. 'his last meeting'), else null. This gets",
          "resolved against real session dates in SQL, not by similarity search.",
          "",
          "subQueries: for multi_hop or comparison, 2+ standalone search queries,",
          "one per piece of evidence needed. Empty array otherwise.",
          "",
          "rewrittenQuery: the question rewritten as a standalone query, resolving",
          "pronouns/references using the conversation history below. If the",
          "question is already standalone, return it unchanged.",
        ].join("\n"),
      },
    ],
    messages: [
      {
        role: "user",
        content: `<conversation_history>\n${historyBlock}\n</conversation_history>\n\n<question>\n${question}\n</question>`,
      },
    ] satisfies Anthropic.MessageParam[],
  });
}
