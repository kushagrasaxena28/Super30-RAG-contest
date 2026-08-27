import { RRF_K } from "../config/constants.js";

export interface FusedHit {
  chunkId: string;
  denseRank: number | null;
  sparseRank: number | null;
  fusedScore: number;
}

/**
 * Reciprocal Rank Fusion (see plan/05-retrieval.md):
 *
 *   score(chunk) = Σ 1 / (k + rank_in_list),  k = 60
 *
 * RRF over score-normalization because cosine similarity and ts_rank live
 * on incomparable scales; rank-based fusion sidesteps calibration
 * entirely. A chunk found by both legs necessarily outranks a chunk found
 * by only one leg at the same rank, because it sums two positive terms.
 *
 * Pure and I/O-free on purpose - this is the piece of hybridSearch worth
 * unit-testing, and it must not drag Prisma/Qdrant/env into a test process.
 * Ranks are 1-indexed; `null` means "absent from that leg".
 */
export function fuseByRrf(denseIds: readonly string[], sparseIds: readonly string[]): FusedHit[] {
  const denseRank = new Map<string, number>();
  denseIds.forEach((id, i) => denseRank.set(id, i + 1));
  const sparseRank = new Map<string, number>();
  sparseIds.forEach((id, i) => sparseRank.set(id, i + 1));

  const allIds = new Set<string>([...denseRank.keys(), ...sparseRank.keys()]);
  const fused = [...allIds].map((id) => {
    const dr = denseRank.get(id) ?? null;
    const sr = sparseRank.get(id) ?? null;
    const score = (dr ? 1 / (RRF_K + dr) : 0) + (sr ? 1 / (RRF_K + sr) : 0);
    return { chunkId: id, denseRank: dr, sparseRank: sr, fusedScore: score };
  });
  // Array#sort is stable, so equal fused scores keep dense-leg-first order.
  fused.sort((a, b) => b.fusedScore - a.fusedScore);
  return fused;
}
