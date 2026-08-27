import { retrieve } from "../retrieval/orchestrator.js";
import { assemblePrompt } from "./promptAssembly.js";
import { generateAnswer } from "./answerGenerator.js";
import { resolveCitations, type DisplaySource } from "./citations.js";
import { filterCitedIds } from "./citationFilter.js";
import { getOrCreateConversation, loadConversation, appendMessage } from "../conversation/store.js";
import { analysisWindow, generationHistory } from "../conversation/window.js";
import { maybeCompressConversation } from "../conversation/compress.js";
import { logger } from "../logger.js";
import type { Candidate } from "../retrieval/hybridSearch.js";

export interface AskResult {
  conversationId: string;
  messageId: string;
  answer: string;
  sources: DisplaySource[];
  sufficientEvidence: boolean;
  assumptions: string[];
  timings: { analysisMs: number; retrievalMs: number; generationMs: number };
}

/**
 * analyze -> retrieve -> generate -> bounded retry (see
 * plan/06-generation.md). Max 2 generation calls - not agentic looping,
 * one bounded widening on insufficient evidence, then answer with what we
 * have (honestly flagged if still incomplete).
 */
export async function ask(question: string, conversationId?: string): Promise<AskResult> {
  const conversation = await getOrCreateConversation(conversationId);
  const withMessages = await loadConversation(conversation.id);
  if (!withMessages) throw new Error("conversation disappeared mid-request");

  const recentTurns = analysisWindow(withMessages.messages);
  const history = generationHistory(withMessages, withMessages.messages);

  let retrievalResult = await retrieve(question, recentTurns);
  let candidates: Candidate[] = retrievalResult.candidates;

  const genStart = Date.now();
  let prompt = await assemblePrompt({ question, candidates, history });
  let generated = await generateAnswer(prompt);

  if (!generated.sufficientEvidence) {
    logger.info({ conversationId: conversation.id }, "insufficient evidence on first pass, widening retrieval");
    const widened = await retrieve(question, recentTurns, { widen: true });
    const widenedPrompt = await assemblePrompt({ question, candidates: widened.candidates, history });
    generated = await generateAnswer(widenedPrompt);
    candidates = widened.candidates;
    retrievalResult = widened;
  }
  const generationMs = Date.now() - genStart;

  const citedIds = filterCitedIds(
    generated.citedChunkIds,
    candidates.map((c) => c.chunkId),
  );
  const sources = await resolveCitations(citedIds);

  await appendMessage({ conversationId: conversation.id, role: "user", content: question });
  const assistantMessage = await appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: generated.answer,
    sources,
  });

  maybeCompressConversation(conversation.id).catch((err) =>
    logger.error({ conversationId: conversation.id, err }, "conversation compression check failed (non-fatal)"),
  );

  return {
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    answer: generated.answer,
    sources,
    sufficientEvidence: generated.sufficientEvidence,
    assumptions: generated.assumptions,
    timings: {
      analysisMs: retrievalResult.analysisMs,
      retrievalMs: retrievalResult.retrievalMs,
      generationMs,
    },
  };
}
