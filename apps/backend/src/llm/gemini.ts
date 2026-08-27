import { z, type ZodType } from "zod";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { consume, type BucketConfig } from "../ratelimit/tokenBucket.js";
import { RefusalError, type StructuredCallOptions, type SystemPrompt } from "./types.js";

const GEMINI_BUCKET: BucketConfig = {
  name: "gemini:llm:rpm",
  refillPerMinute: 60,
  capacity: 60,
};

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 4;

interface GeminiContentPart {
  text?: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiContentPart[];
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiContentPart[];
      role?: string;
    };
    finishReason?: string;
    safetyRatings?: Array<{
      category: string;
      probability: string;
      blocked?: boolean;
    }>;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

/**
 * Converts a standard JSON Schema (from z.toJSONSchema) to Gemini's OpenAPI 3.0-compatible schema.
 */
export function toGeminiSchema(schema: unknown): any {
  if (!schema || typeof schema !== "object") return schema;

  const s = { ...(schema as any) };
  delete s["$schema"];
  delete s["additionalProperties"];

  // Handle anyOf with null -> nullable: true
  if (Array.isArray(s.anyOf)) {
    const isNullable = s.anyOf.some((sub: any) => sub.type === "null");
    const nonNull = s.anyOf.find((sub: any) => sub.type !== "null");
    if (nonNull) {
      const converted = toGeminiSchema(nonNull);
      if (isNullable) converted.nullable = true;
      return converted;
    }
  }

  // Handle type uppercase formatting
  if (typeof s.type === "string") {
    s.type = s.type.toUpperCase();
  }

  if (s.properties && typeof s.properties === "object") {
    const props: Record<string, any> = {};
    for (const [key, value] of Object.entries(s.properties)) {
      props[key] = toGeminiSchema(value);
    }
    s.properties = props;
  }

  if (s.items) {
    s.items = toGeminiSchema(s.items);
  }

  return s;
}

function flattenSystemPrompt(system?: SystemPrompt): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((item) => (typeof item === "string" ? item : item.text))
      .filter(Boolean)
      .join("\n\n");
  }
  return undefined;
}

export async function geminiStructuredCall<Schema extends ZodType>(
  opts: StructuredCallOptions<Schema>,
): Promise<z.infer<Schema>> {
  await consume(GEMINI_BUCKET, 1);

  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const systemText = flattenSystemPrompt(opts.system);
  const contents: GeminiContent[] = opts.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const jsonSchema = toGeminiSchema(z.toJSONSchema(opts.schema));

  const body = {
    ...(systemText
      ? {
          systemInstruction: {
            parts: [{ text: systemText }],
          },
        }
      : {}),
    contents,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: jsonSchema,
      ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
      temperature: 0.1,
    },
  };

  const start = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY ?? "",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        if (res.status === 429 || res.status >= 500) {
          const match = bodyText.match(/retry in ([\d\.]+)s/i);
          const delayMs = match ? Math.ceil(Number(match[1]) * 1000) + 1000 : 2000 * Math.pow(2, attempt - 1);
          logger.warn({ label: opts.label, status: res.status, attempt, delayMs }, "gemini rate limited or 5xx, retrying");
          await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 60_000)));
          continue;
        }
        throw new Error(`Gemini request failed (${res.status}): ${bodyText.slice(0, 500)}`);
      }

      const data = (await res.json()) as GeminiGenerateResponse;

      if (data.promptFeedback?.blockReason) {
        throw new RefusalError(data.promptFeedback.blockReason, "Prompt was blocked by safety filters");
      }

      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new Error(`${opts.label}: Gemini returned no candidates`);
      }

      if (candidate.finishReason === "SAFETY" || candidate.finishReason === "BLOCKLIST") {
        throw new RefusalError(candidate.finishReason, "Candidate was blocked by safety filters");
      }

      const responseText = candidate.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error(`${opts.label}: Gemini candidate had empty text part`);
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(responseText);
      } catch (err) {
        throw new Error(`${opts.label}: Failed to parse JSON response: ${responseText.slice(0, 300)}`);
      }

      const validated = opts.schema.parse(parsedJson);
      const elapsedMs = Date.now() - start;

      logger.info(
        {
          label: opts.label,
          elapsedMs,
          finishReason: candidate.finishReason,
          inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
          thoughtsTokens: data.usageMetadata?.thoughtsTokenCount ?? 0,
        },
        "gemini llm call complete",
      );

      return validated;
    } catch (err) {
      if (err instanceof RefusalError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  logger.error({ label: opts.label, err: lastError?.message }, "gemini llm call failed");
  throw lastError ?? new Error(`${opts.label}: Gemini structured call failed after retries`);
}
