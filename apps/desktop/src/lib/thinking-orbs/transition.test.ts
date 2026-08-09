/**
 * Unit tests for the orb crossfade transition state machine.
 */
import { describe, expect, it } from "vitest";
import {
  advanceTransition,
  easeOutCubic,
  nextTransition,
  transitionAlpha,
} from "./transition";

describe("easeOutCubic", () => {
  it("hits both endpoints", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("is monotonic non-decreasing", () => {
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = easeOutCubic(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("nextTransition", () => {
  it("returns null when nothing changes", () => {
    expect(nextTransition("working", "working")).toBeNull();
  });

  it("starts a fresh transition between different states", () => {
    expect(nextTransition("breathing", "working")).toEqual({
      from: "breathing",
      to: "working",
      elapsedMs: 0,
    });
  });
});

describe("advanceTransition", () => {
  it("accumulates frame deltas", () => {
    const tr = nextTransition("breathing", "working")!;
    const t1 = advanceTransition(tr, 100, 350)!;
    expect(t1.elapsedMs).toBe(100);
    const t2 = advanceTransition(t1, 150, 350)!;
    expect(t2.elapsedMs).toBe(250);
  });

  it("completes once elapsed reaches the duration", () => {
    const tr = nextTransition("breathing", "working")!;
    expect(advanceTransition(tr, 350, 350)).toBeNull();
    expect(advanceTransition(tr, 1000, 350)).toBeNull();
  });

  it("preserves from/to while advancing", () => {
    const tr = nextTransition("breathing", "working")!;
    const t1 = advanceTransition(tr, 100, 350)!;
    expect(t1.from).toBe("breathing");
    expect(t1.to).toBe("working");
  });
});

describe("transitionAlpha", () => {
  it("is 0 at the start and 1 at the end", () => {
    const tr = nextTransition("breathing", "working")!;
    expect(transitionAlpha(tr, 350)).toBe(0);
    const done = advanceTransition(tr, 350, 350);
    expect(done).toBeNull();
    // clamp: any alpha beyond the duration reads as fully incoming
    const over = { ...tr, elapsedMs: 500 };
    expect(transitionAlpha(over, 350)).toBe(1);
  });

  it("eases out: mid-way is past the linear midpoint", () => {
    const mid = { ...nextTransition("breathing", "working")!, elapsedMs: 175 };
    expect(transitionAlpha(mid, 350)).toBeGreaterThan(0.5);
    expect(transitionAlpha(mid, 350)).toBeLessThan(1);
  });
});
