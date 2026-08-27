export type SourceType = "transcript" | "reference_document";

export interface AskSource {
  chunkId: string;
  label: string;
  sourceType: SourceType;
  clientName?: string;
  sessionDate?: string;
  section?: string;
  standardCode?: string;
  excerpt: string;
  isSummary: boolean;
}

export interface Timings {
  analysisMs: number;
  retrievalMs: number;
  generationMs: number;
}

export interface AskResponse {
  conversationId: string;
  messageId: string;
  answer: string;
  sources: AskSource[];
  sufficientEvidence: boolean;
  assumptions: string[];
  timings: Timings;
}

export interface UploadResponse {
  jobId: string;
  status: "queued";
  deduplicated: boolean;
  sourceId?: string;
}

export type JobState = "queued" | "active" | "completed" | "failed";

export type JobStage =
  | "extracting"
  | "classifying"
  | "labeling"
  | "chunking"
  | "embedding"
  | "storing"
  | "summarizing"
  | "ready";

export interface JobResult {
  sourceId: string;
  sourceType: SourceType;
  clientName?: string;
  chunkCount: number;
  warnings: string[];
}

export interface JobStatus {
  jobId: string;
  state: JobState;
  stage: JobStage;
  progress: number;
  result?: JobResult;
  error?: string;
}

export type SourceStatus = "pending" | "processing" | "ready" | "failed";

export interface SourceItem {
  id: string;
  filename: string;
  sourceType: SourceType;
  status: SourceStatus;
  clientName?: string;
  sessionDate?: string;
  chunkCount: number;
  labelingSuspect: boolean;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  createdAt: string;
  title?: string;
  preview?: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AskSource[];
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  createdAt: string;
  messages: ConversationMessage[];
}

export interface HealthResponse {
  status: "ok" | "degraded";
  postgres: boolean;
  qdrant: boolean;
  redis: boolean;
  ingestion: {
    pending: number;
    processing: number;
    ready: number;
    failed: number;
  };
}
