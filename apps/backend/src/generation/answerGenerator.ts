import { z } from "zod";
import { structuredCall } from "../llm/anthropic.js";
import type { AssembledPrompt } from "./promptAssembly.js";

export const AnswerSchema = z.object({
  answer: z.string(),
  citedChunkIds: z.array(z.string()),
  sufficientEvidence: z.boolean(),
  assumptions: z.array(z.string()),
});

export type GeneratedAnswer = z.infer<typeof AnswerSchema>;

/**
 * The structured call - relevance filtering, synthesis, and citation all
 * happen in this one call rather than a separate rerank step (see
 * plan/06-generation.md: the corpus is small enough that a dedicated
 * reranker earns nothing at this candidate-set size).
 */
export async function generateAnswer(prompt: AssembledPrompt): Promise<GeneratedAnswer> {
  return structuredCall({
    label: "generation.answer",
    effort: "high",
    schema: AnswerSchema,
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: 16000,
  });
}
