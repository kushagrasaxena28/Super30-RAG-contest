import type { ZodType } from "zod";

export type Effort = "low" | "medium" | "high";

export interface LlmTextBlock {
  type: "text";
  text: string;
}

export type SystemPrompt = string | LlmTextBlock[] | string[];

export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Thrown immediately, no retry, when a provider reports its quota as fully
 * exhausted (e.g. a free-tier daily cap) rather than merely a transient
 * per-minute rate limit. The two look identical as a bare HTTP 429, but
 * retrying a transient limit for a few seconds can succeed while retrying an
 * exhausted daily quota never can - looping the normal backoff on it just
 * turns a request into several minutes of silent "Thinking..." with a
 * guaranteed failure at the end. See llm/gemini.ts for the detection.
 */
export class QuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

export class RefusalError extends Error {
  constructor(
    public readonly category: string | null,
    public readonly explanation: string | null,
  ) {
    super(`Model refused: ${category ?? "unspecified"}`);
    this.name = "RefusalError";
  }
}

export interface StructuredCallOptions<Schema extends ZodType> {
  system?: SystemPrompt;
  messages: LlmMessage[];
  schema: Schema;
  effort: Effort;
  maxTokens?: number;
  label: string; // for logging
}
