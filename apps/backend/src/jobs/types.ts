export type JobOrigin = "bootstrap" | "upload";

export interface IngestJobData {
  filePath: string; // path in the shared volume / local UPLOAD_DIR
  originalName: string;
  contentHash: string;
  origin: JobOrigin;
}

export interface IngestJobResult {
  sourceId: string;
  sourceType: "transcript" | "reference_document";
  clientId?: string;
  clientName?: string;
  chunkCount: number;
  labelingSuspect?: boolean;
  warnings: string[];
}

export type JobStage =
  | "queued"
  | "extracting"
  | "classifying"
  | "labeling"
  | "chunking"
  | "embedding"
  | "storing"
  | "summarizing"
  | "ready";

export interface JobProgress {
  stage: JobStage;
  pct: number;
  detail?: string;
}

export const INGEST_QUEUE_NAME = "ingest";
