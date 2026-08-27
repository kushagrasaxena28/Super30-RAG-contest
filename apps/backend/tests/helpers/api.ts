import { BASE_URL, PROBE_TIMEOUT_MS, RETRIEVAL_TIMEOUT_MS, ASK_TIMEOUT_MS } from "./config.js";
import type { ChunkMetadata, HealthStatus } from "../../src/types/domain.js";

/** Response shapes, transcribed from plan/08-api-contract.md and checked
 * against the actual routers in src/api/routes/. */

export type HealthPayload = HealthStatus;

export interface SourceRow {
  id: string;
  filename: string;
  sourceType: "transcript" | "reference_document";
  status: string;
  clientName: string | null;
  sessionDate: string | null;
  chunkCount: number;
  labelingSuspect: boolean;
  createdAt: string;
}

export interface QueryAnalysisPayload {
  queryType: "factoid" | "broad_theme" | "multi_hop" | "comparison";
  clientName: string | null;
  temporalRef: "last" | "first" | "all" | null;
  subQueries: string[];
  rewrittenQuery: string;
}

export interface DebugCandidate {
  chunkId: string;
  sourceId: string;
  denseRank: number | null;
  sparseRank: number | null;
  fusedScore: number;
  metadata: ChunkMetadata;
  excerpt: string;
}

export interface DebugRetrievalPayload {
  analysis: QueryAnalysisPayload;
  resolvedClientId: string | null;
  resolvedSessionDate: string | null;
  candidates: DebugCandidate[];
}

export interface AskSource {
  chunkId: string;
  label: string;
  sourceType: "transcript" | "reference_document";
  clientName?: string;
  sessionDate?: string;
  section?: string;
  standardCode?: string;
  excerpt: string;
  isSummary: boolean;
}

export interface AskPayload {
  conversationId: string;
  messageId: string;
  answer: string;
  sources: AskSource[];
  sufficientEvidence: boolean;
  assumptions: string[];
  timings: { analysisMs: number; retrievalMs: number; generationMs: number };
}

export interface UploadPayload {
  jobId: string;
  status: string;
  deduplicated: boolean;
  sourceId?: string;
}

export interface JobPayload {
  jobId: string;
  state: "queued" | "active" | "completed" | "failed";
  stage: string;
  progress: number;
  result?: { sourceId: string; sourceType: string; clientName?: string; chunkCount: number; warnings: string[] };
  error?: string;
}

export interface ConversationPayload {
  id: string;
  createdAt: string;
  messages: Array<{ id: string; role: string; content: string; sources?: AskSource[]; createdAt: string }>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 400)}`, res.status, text);
  }
  return JSON.parse(text) as T;
}

export function getJson<T>(path: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<T> {
  return request<T>(path, { method: "GET" }, timeoutMs);
}

export function postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  return request<T>(
    path,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    timeoutMs,
  );
}

export const getHealth = () => getJson<HealthPayload>("/api/health");

export const getSources = () => getJson<{ sources: SourceRow[] }>("/api/sources").then((r) => r.sources);

export const debugRetrieval = (question: string) =>
  postJson<DebugRetrievalPayload>("/api/debug/retrieval", { question }, RETRIEVAL_TIMEOUT_MS);

export const ask = (question: string, conversationId?: string) =>
  postJson<AskPayload>("/api/ask", conversationId ? { question, conversationId } : { question }, ASK_TIMEOUT_MS);

export const getConversation = (id: string) => getJson<ConversationPayload>(`/api/conversations/${id}`);

export const getJob = (id: string) => getJson<JobPayload>(`/api/jobs/${encodeURIComponent(id)}`);

export async function uploadFile(filename: string, bytes: Uint8Array, contentType: string): Promise<UploadPayload> {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], filename, { type: contentType }));
  const res = await fetch(`${BASE_URL}/api/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 4),
  });
  const text = await res.text();
  if (res.status !== 202) {
    throw new ApiError(`POST /api/upload -> ${res.status}: ${text.slice(0, 400)}`, res.status, text);
  }
  return JSON.parse(text) as UploadPayload;
}

export async function deleteSource(id: string): Promise<void> {
  await fetch(`${BASE_URL}/api/sources/${id}`, { method: "DELETE", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 4) });
}

/** Poll a job to a terminal state. Used by the upload e2e test. */
export async function waitForJob(jobId: string, timeoutMs: number): Promise<JobPayload> {
  const deadline = Date.now() + timeoutMs;
  let last: JobPayload | undefined;
  while (Date.now() < deadline) {
    last = await getJob(jobId);
    if (last.state === "completed" || last.state === "failed") return last;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`job ${jobId} did not reach a terminal state within ${timeoutMs}ms (last stage: ${last?.stage})`);
}

/** Source-id -> row, so candidate rows (which carry only sourceId) can be
 * described by filename/client in assertions and failure messages. */
export function indexSourcesById(sources: SourceRow[]): Map<string, SourceRow> {
  return new Map(sources.map((s) => [s.id, s]));
}

export function describeCandidate(c: DebugCandidate, byId: Map<string, SourceRow>): string {
  const src = byId.get(c.sourceId);
  const bits = [
    src?.filename ?? c.sourceId,
    c.metadata?.standardCode,
    c.metadata?.categoryOrSection,
    c.metadata?.isSummary ? "summary" : undefined,
    `dense=${c.denseRank ?? "-"} sparse=${c.sparseRank ?? "-"} fused=${c.fusedScore.toFixed(5)}`,
  ].filter(Boolean);
  return bits.join(" | ");
}
