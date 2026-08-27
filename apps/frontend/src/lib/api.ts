import type {
  AskResponse,
  ConversationDetail,
  ConversationSummary,
  HealthResponse,
  JobStatus,
  SourceItem,
  UploadResponse,
} from "@/lib/types";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:3001";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB, mirrors the backend's cap

export class ApiError extends Error {
  code?: string;
  details?: unknown;
  status?: number;
  /** true when the request never reached the server (network error, server down) */
  isNetworkError: boolean;

  constructor(
    message: string,
    opts: { code?: string; details?: unknown; status?: number; isNetworkError?: boolean } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = opts.code;
    this.details = opts.details;
    this.status = opts.status;
    this.isNetworkError = opts.isNetworkError ?? false;
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(`Can't reach the API at ${API_URL}`, { isNetworkError: true });
  }

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // response body wasn't JSON (or was empty) — fall back to a generic message
    }
    throw new ApiError(body?.error?.message || `Request failed with status ${res.status}`, {
      code: body?.error?.code,
      details: body?.error?.details,
      status: res.status,
    });
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  ask(question: string, conversationId?: string) {
    return request<AskResponse>("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, conversationId }),
    });
  },

  upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    return request<UploadResponse>("/api/upload", { method: "POST", body: form });
  },

  getJob(jobId: string) {
    return request<JobStatus>(`/api/jobs/${jobId}`);
  },

  getSources() {
    return request<{ sources: SourceItem[] }>("/api/sources").then((r) => r.sources);
  },

  deleteSource(id: string) {
    return request<void>(`/api/sources/${id}`, { method: "DELETE" });
  },

  async getConversations(): Promise<ConversationSummary[]> {
    // The spec doesn't pin down whether this is a bare array or a wrapped
    // object, so accept either shape defensively without inventing fields.
    const data = await request<ConversationSummary[] | { conversations: ConversationSummary[] }>(
      "/api/conversations",
    );
    return Array.isArray(data) ? data : (data.conversations ?? []);
  },

  getConversation(id: string) {
    return request<ConversationDetail>(`/api/conversations/${id}`);
  },

  getHealth() {
    return request<HealthResponse>("/api/health");
  },
};
