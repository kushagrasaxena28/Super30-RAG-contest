import type { ChunkMetadata } from "../types/domain.js";

/** A chunk before it has a database id - what every chunker returns. */
export interface PendingChunk {
  text: string;
  metadata: ChunkMetadata;
}

export interface ChunkerContext {
  sourceType: ChunkMetadata["sourceType"];
  clientId?: string;
  sessionDate?: string;
}
