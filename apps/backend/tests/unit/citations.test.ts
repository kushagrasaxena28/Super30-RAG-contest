import { describe, expect, test } from "bun:test";
import { filterCitedIds, orderAndDropUnknown } from "../../src/generation/citationFilter.js";

/**
 * The anti-fabricated-citation guarantee (plan/06-generation.md). Two
 * independent gates stand between model output and a rendered source:
 *
 *   1. askPipeline filters the model's citedChunkIds against the ids it was
 *      actually shown (filterCitedIds).
 *   2. citations.resolveCitations drops any id with no database row
 *      (orderAndDropUnknown).
 *
 * Either one alone makes an invented citation impossible to render. These
 * are the most important assertions in the unit layer.
 */

const CANDIDATES = ["chunk-a", "chunk-b", "chunk-c"];

describe("filterCitedIds - gate 1: ids the model was never shown", () => {
  test("drops an id that is not in the candidate set", () => {
    expect(filterCitedIds(["chunk-a", "totally-made-up"], CANDIDATES)).toEqual(["chunk-a"]);
  });

  test("drops a plausible-looking uuid the model invented", () => {
    const invented = "3f1c2b4e-8a90-4d21-9f77-0c5b6a1d2e33";
    expect(filterCitedIds([invented], CANDIDATES)).toEqual([]);
  });

  test("drops everything when nothing cited was supplied", () => {
    expect(filterCitedIds(["x", "y", "z"], CANDIDATES)).toEqual([]);
  });

  test("keeps the model's citation order", () => {
    expect(filterCitedIds(["chunk-c", "chunk-a"], CANDIDATES)).toEqual(["chunk-c", "chunk-a"]);
  });

  test("an empty candidate set means no citation can survive", () => {
    expect(filterCitedIds(["chunk-a"], [])).toEqual([]);
  });

  test("is not fooled by near-miss ids", () => {
    expect(filterCitedIds(["chunk-a ", "CHUNK-A", "chunk-a1", "chunk-a"], CANDIDATES)).toEqual(["chunk-a"]);
  });

  test("accepts a Set of candidate ids as well as an array", () => {
    expect(filterCitedIds(["chunk-b", "nope"], new Set(CANDIDATES))).toEqual(["chunk-b"]);
  });
});

describe("orderAndDropUnknown - gate 2: ids with no database row", () => {
  const rows = [
    { id: "chunk-a", text: "grievance timeline" },
    { id: "chunk-b", text: "principle two" },
  ];
  const keyOf = (r: { id: string }) => r.id;

  test("DROPS a cited id that has no matching row - never renders it", () => {
    const out = orderAndDropUnknown(["chunk-a", "ghost-chunk", "chunk-b"], rows, keyOf);
    expect(out.map((r) => r.id)).toEqual(["chunk-a", "chunk-b"]);
    expect(out.some((r) => r.id === "ghost-chunk")).toBe(false);
  });

  test("returns nothing at all when every cited id is unknown", () => {
    expect(orderAndDropUnknown(["ghost-1", "ghost-2"], rows, keyOf)).toEqual([]);
  });

  test("preserves the order the model cited them in, not row order", () => {
    const out = orderAndDropUnknown(["chunk-b", "chunk-a"], rows, keyOf);
    expect(out.map((r) => r.id)).toEqual(["chunk-b", "chunk-a"]);
  });

  test("never emits a placeholder for a dropped id", () => {
    const out = orderAndDropUnknown(["ghost", "chunk-a"], rows, keyOf);
    expect(out).toHaveLength(1);
    expect(out.every((r) => r !== undefined && r !== null)).toBe(true);
  });

  test("no rows means no sources", () => {
    expect(orderAndDropUnknown(["chunk-a"], [], keyOf)).toEqual([]);
  });

  test("both gates composed: only ids that were supplied AND exist survive", () => {
    const modelOutput = ["chunk-a", "hallucinated-id", "chunk-c"];
    // chunk-c was a candidate but its row is gone (deleted mid-request).
    const survived = orderAndDropUnknown(filterCitedIds(modelOutput, CANDIDATES), rows, keyOf);
    expect(survived.map((r) => r.id)).toEqual(["chunk-a"]);
  });
});
