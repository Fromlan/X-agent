/** Lock the Pi-normalized cache ratio to all three disjoint input buckets. */
import { describe, expect, it } from "vitest";
import { cacheHitRatio } from "./cache-hit";

describe("prompt cache accounting", () => {
  it("includes cache writes in the denominator without counting them as hits", () => {
    expect(cacheHitRatio({ input: 10_000, cacheRead: 80_000, cacheWrite: 40_000 })).toBeCloseTo(0.6153846154);
    expect(cacheHitRatio({ input: 0, cacheRead: 0, cacheWrite: 40_000 })).toBe(0);
  });
});
