export type SourceTypeValue = "transcript" | "reference_document";
export type SpeakerLabel = "case_manager" | "client";

/** Shape stored in Chunk.metadata (jsonb) - see prisma/schema.prisma. */
export interface ChunkMetadata {
  clientId?: string;
  sourceType: SourceTypeValue;
  sessionDate?: string; // ISO date
  categoryOrSection?: string; // e.g. "Timeline for Filing a Grievance", "Client Development (CD)"
  standardCode?: string; // e.g. "CD-080"
  isSummary: boolean;
  speakerSource?: "inferred";
  turnRange?: [number, number];
}

export interface HealthStatus {
  status: "ok" | "degraded";
  postgres: boolean;
  qdrant: boolean;
  redis: boolean;
  ingestion: { pending: number; processing: number; ready: number; failed: number };
}
