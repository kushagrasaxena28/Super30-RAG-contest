import type { ZodType, z as ZodNamespace } from "zod";
import { env } from "../config/env.js";
import { geminiStructuredCall } from "./gemini.js";
import { anthropicStructuredCall } from "./anthropic.js";
import type { StructuredCallOptions } from "./types.js";

export * from "./types.js";
export { isRetryableAnthropicError } from "./anthropic.js";

/**
 * Unified entry point for all structured LLM calls.
 * Dispatches to Gemini (default) or Anthropic based on env.LLM_PROVIDER.
 */
export async function structuredCall<Schema extends ZodType>(
  opts: StructuredCallOptions<Schema>,
): Promise<ZodNamespace.infer<Schema>> {
  if (env.LLM_PROVIDER === "anthropic") {
    return anthropicStructuredCall(opts);
  }
  return geminiStructuredCall(opts);
}
