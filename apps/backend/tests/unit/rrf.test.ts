import { describe, expect, test } from "bun:test";
import { fuseByRrf } from "../../src/retrieval/rrf.js";
import { RRF_K } from "../../src/config/constants.js";

/** The formula from plan/05-retrieval.md, written out independently of the
 * implementation so the test would catch an off-by-one in either direction. */
const rrf = (rank: number) => 1 / (RRF_K + rank);

describe("fuseByRrf", () => {
  test("returns nothing when neither leg found anything", () => {
    expect(fuseByRrf([], [])).toEqual([]);
  });

  test("ranks are 1-indexed: the top dense hit scores 1/(k+1), not 1/k", () => {
    const [top] = fuseByRrf(["a", "b"], []);
    expect(top).toEqual({ chunkId: "a", denseRank: 1, sparseRank: null, fusedScore: rrf(1) });
    expect(top!.fusedScore).not.toBe(1 / RRF_K);
  });

  test("sums the two legs and reports each leg's rank", () => {
    // dense: x(1) both(2)   sparse: y(1) both(2)
    const fused = fuseByRrf(["x", "both"], ["y", "both"]);
    const byId = new Map(fused.map((f) => [f.chunkId, f]));

    expect(byId.get("both")).toEqual({
      chunkId: "both",
      denseRank: 2,
      sparseRank: 2,
      fusedScore: rrf(2) + rrf(2),
    });
    expect(byId.get("x")).toEqual({ chunkId: "x", denseRank: 1, sparseRank: null, fusedScore: rrf(1) });
    expect(byId.get("y")).toEqual({ chunkId: "y", denseRank: null, sparseRank: 1, fusedScore: rrf(1) });
  });

  test("a chunk hit by BOTH legs outranks one hit by a single leg at the same rank", () => {
    // The core reason hybrid search is worth doing at all.
    for (const rank of [1, 2, 5, 30]) {
      const pad = (prefix: string) => Array.from({ length: rank - 1 }, (_, i) => `${prefix}${i}`);
      const both = fuseByRrf([...pad("d"), "both"], [...pad("s"), "both"]);
      const single = fuseByRrf([...pad("d"), "single"], []);

      const bothScore = both.find((f) => f.chunkId === "both")!.fusedScore;
      const singleScore = single.find((f) => f.chunkId === "single")!.fusedScore;

      expect(bothScore).toBe(rrf(rank) * 2);
      expect(singleScore).toBe(rrf(rank));
      expect(bothScore).toBeGreaterThan(singleScore);
    }
  });

  test("agreement beats depth: a rank-2/rank-2 double hit outranks a rank-1 single hit", () => {
    const fused = fuseByRrf(["denseOnly", "both"], ["sparseOnly", "both"]);
    expect(fused[0]!.chunkId).toBe("both");
    expect(fused[0]!.fusedScore).toBeGreaterThan(fused[1]!.fusedScore);
  });

  test("sorts descending by fused score", () => {
    const fused = fuseByRrf(["a", "b", "c"], ["c", "a"]);
    const scores = fused.map((f) => f.fusedScore);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    // a: dense 1 + sparse 2, c: dense 3 + sparse 1, b: dense 2 only
    expect(fused.map((f) => f.chunkId)).toEqual(["a", "c", "b"]);
  });

  test("keeps sparse-only hits - the whole point of the FTS leg", () => {
    // "CD-080" is the case that dense retrieval handles poorly.
    const fused = fuseByRrf(["vector-hit"], ["cd-080-chunk", "vector-hit"]);
    expect(fused.map((f) => f.chunkId).sort()).toEqual(["cd-080-chunk", "vector-hit"]);
    expect(fused.find((f) => f.chunkId === "cd-080-chunk")).toMatchObject({ denseRank: null, sparseRank: 1 });
  });

  test("ties keep dense-leg order (stable sort)", () => {
    const fused = fuseByRrf(["d1"], ["s1"]);
    expect(fused[0]!.fusedScore).toBe(fused[1]!.fusedScore);
    expect(fused.map((f) => f.chunkId)).toEqual(["d1", "s1"]);
  });

  test("never invents a chunk id that was in neither leg", () => {
    const fused = fuseByRrf(["a"], ["b"]);
    expect(new Set(fused.map((f) => f.chunkId))).toEqual(new Set(["a", "b"]));
  });
});
