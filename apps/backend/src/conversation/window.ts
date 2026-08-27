import type { Message, Conversation } from "@prisma/client";
import type { ConversationTurn } from "../retrieval/queryAnalysis.js";
import type { LlmMessage } from "../llm/types.js";

const ANALYSIS_TURN_COUNT = 4;
export const VERBATIM_TURN_COUNT = 6;

/** Query analysis gets the last ~4 turns - produces `rewrittenQuery` (see
 * plan/05-retrieval.md, plan/07-conversation.md). */
export function analysisWindow(messages: Message[]): ConversationTurn[] {
  return messages.slice(-ANALYSIS_TURN_COUNT).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

/**
 * Generation gets `summary` (if any) + the last N verbatim turns - never
 * the raw pronoun-laden follow-up, and never everything (see
 * plan/07-conversation.md). Messages summarized-over (older than
 * `summarizedUpTo`) are excluded here but remain in Postgres and are
 * still returned in full by GET /api/conversations/:id.
 */
export function generationHistory(
  conversation: Pick<Conversation, "summary" | "summarizedUpTo">,
  messages: Message[],
): LlmMessage[] {
  const verbatim = conversation.summarizedUpTo
    ? messages.filter((m) => m.createdAt > conversation.summarizedUpTo!)
    : messages;

  const windowed = verbatim.slice(-VERBATIM_TURN_COUNT);

  const history: LlmMessage[] = [];
  if (conversation.summary) {
    history.push({
      role: "user",
      content: `<conversation_summary>\n${conversation.summary}\n</conversation_summary>`,
    });
    history.push({ role: "assistant", content: "Understood - I'll use that context for this conversation." });
  }

  for (const m of windowed) {
    history.push({ role: m.role as "user" | "assistant", content: m.content });
  }

  return history;
}
