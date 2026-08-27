import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType, z as ZodNamespace } from "zod";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { consume, type BucketConfig } from "../ratelimit/tokenBucket.js";
import { RefusalError, type StructuredCallOptions, type SystemPrompt } from "./types.js";

export const MODEL = "claude-opus-5";

const ANTHROPIC_BUCKET: BucketConfig = {
  name: "anthropic:rpm",
  refillPerMinute: env.ANTHROPIC_RATE_LIMIT_RPM,
  capacity: env.ANTHROPIC_RATE_LIMIT_BURST ?? env.ANTHROPIC_RATE_LIMIT_RPM,
};

let client: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY ?? "", timeout: 120_000 });
  }
  return client;
}

function formatSystem(system?: SystemPrompt): Anthropic.TextBlockParam[] | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return [{ type: "text", text: system }];
  if (Array.isArray(system)) {
    return system.map((item) =>
      typeof item === "string" ? { type: "text", text: item } : item,
    );
  }
  return undefined;
}

export async function anthropicStructuredCall<Schema extends ZodType>(
  opts: StructuredCallOptions<Schema>,
): Promise<ZodNamespace.infer<Schema>> {
  const anthropic = getAnthropicClient();
  const system = formatSystem(opts.system);

  await consume(ANTHROPIC_BUCKET, 1);

  const anthropicMessages: Anthropic.MessageParam[] = opts.messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const start = Date.now();
  let response;
  try {
    response = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort, format: zodOutputFormat(opts.schema) },
      ...(system ? { system } : {}),
      messages: anthropicMessages,
    });
  } catch (err) {
    logger.error({ label: opts.label, err: serializeErr(err) }, "llm call failed");
    throw err;
  }

  const elapsedMs = Date.now() - start;
  logger.info(
    {
      label: opts.label,
      elapsedMs,
      stopReason: response.stop_reason,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
    "llm call complete",
  );

  if (response.stop_reason === "refusal") {
    const details = (response as unknown as { stop_details?: { category?: string; explanation?: string } })
      .stop_details;
    throw new RefusalError(details?.category ?? null, details?.explanation ?? null);
  }

  if (response.parsed_output == null) {
    throw new Error(`${opts.label}: model response failed to parse against schema`);
  }

  return response.parsed_output;
}

function serializeErr(err: unknown) {
  if (err instanceof Anthropic.APIError) {
    return { name: err.constructor.name, status: err.status, message: err.message };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

export function isRetryableAnthropicError(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIError && typeof err.status === "number") {
    return err.status === 429 || err.status >= 500;
  }
  return false;
}
