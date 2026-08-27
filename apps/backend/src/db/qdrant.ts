import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../config/env.js";
import { QDRANT_DISTANCE } from "../config/constants.js";
// Both derived from the selected EMBEDDING_PROVIDER - the collection is
// created at whatever dimension the active provider actually emits, never a
// hardcoded number that can drift from it.
import { EMBEDDING_DIM, EMBEDDING_MODEL } from "../embeddings/index.js";

export const qdrant = new QdrantClient({ url: env.QDRANT_URL });

// Fixed nil UUID for the {model, dim} marker point - never a real chunk id,
// so it can never collide with a chunk upsert.
const MARKER_POINT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Idempotent - safe to call on every boot (migrate service, and again from
 * any process that touches Qdrant). Creates the collection if it doesn't
 * exist; does nothing if it already does. Also asserts a {model, dim}
 * marker stored as a dedicated point's payload - changing the embedding
 * model or dimension invalidates every stored vector, and this refuses to
 * boot on a silent mismatch rather than serving nonsense results from a
 * resized/rebuilt collection (see plan/04-embeddings-and-storage.md).
 */
export async function ensureQdrantCollection(): Promise<void> {
  const { collections } = await qdrant.getCollections();
  const exists = collections.some((c) => c.name === env.QDRANT_COLLECTION);

  if (!exists) {
    await qdrant.createCollection(env.QDRANT_COLLECTION, {
      vectors: { size: EMBEDDING_DIM, distance: QDRANT_DISTANCE },
    });
    await qdrant.upsert(env.QDRANT_COLLECTION, {
      points: [
        {
          id: MARKER_POINT_ID,
          vector: new Array(EMBEDDING_DIM).fill(0),
          payload: { __marker: true, model: EMBEDDING_MODEL, dim: EMBEDDING_DIM },
        },
      ],
    });
    return;
  }

  const [marker] = await qdrant.retrieve(env.QDRANT_COLLECTION, {
    ids: [MARKER_POINT_ID],
    with_payload: true,
  });

  if (!marker) {
    // Pre-existing collection from before the marker existed - backfill
    // rather than fail, since we can't know its true provenance.
    await qdrant.upsert(env.QDRANT_COLLECTION, {
      points: [
        {
          id: MARKER_POINT_ID,
          vector: new Array(EMBEDDING_DIM).fill(0),
          payload: { __marker: true, model: EMBEDDING_MODEL, dim: EMBEDDING_DIM },
        },
      ],
    });
    return;
  }

  const payload = marker.payload as { model?: string; dim?: number } | undefined;
  if (payload?.model !== EMBEDDING_MODEL || payload?.dim !== EMBEDDING_DIM) {
    throw new Error(
      `Qdrant collection "${env.QDRANT_COLLECTION}" was built with embedding {model: ${payload?.model}, dim: ${payload?.dim}} ` +
        `but the app is configured for {model: ${EMBEDDING_MODEL}, dim: ${EMBEDDING_DIM}} ` +
        `(EMBEDDING_PROVIDER=${env.EMBEDDING_PROVIDER}). ` +
        `Changing provider or model invalidates every stored vector: drop the collection and re-ingest.`,
    );
  }
}

export async function qdrantHealthy(): Promise<boolean> {
  try {
    await qdrant.getCollections();
    return true;
  } catch {
    return false;
  }
}
