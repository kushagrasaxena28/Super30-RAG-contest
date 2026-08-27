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
