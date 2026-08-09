/**
 * Unit tests for the orb engine primitives (src/lib/thinking-orbs).
 * Pure math + the z-sorted painter; the canvas renderer itself is
 * exercised via npm run dev.
 */
import { describe, expect, it } from "vitest";
import {
  fibDir,
  frac,
  hashD,
  lerp,
  makeProj,
  paint,
  paintLines,
  radiusScale,
} from "./core";

describe("hashD", () => {
  it("stays within [0, 1) and is deterministic", () => {
    for (let i = 0; i < 50; i++) {
      const h = hashD(i, i * 3 + 1);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(hashD(i, i * 3 + 1)).toBe(h);
    }
  });
});

describe("lerp", () => {
  it("interpolates linearly and clamps at the endpoints", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
  });
});

describe("frac", () => {
  it("returns the wrapped fractional part", () => {
    expect(frac(2.7)).toBeCloseTo(0.7);
    expect(frac(-0.3)).toBeCloseTo(0.7);
  });
});

describe("fibDir", () => {
  it("distributes directions on the unit sphere", () => {
    for (let i = 0; i < 10; i++) {
      const [x, y, z] = fibDir(i, 10);
      const len = Math.hypot(x, y, z);
      expect(len).toBeGreaterThan(0.99);
      expect(len).toBeLessThan(1.01);
    }
  });
});

describe("makeProj", () => {
  it("projects the +x unit point to the right of center", () => {
    const pt = makeProj(0, 0, 10, 10, 1);
    expect(pt(1, 0, 0)).toEqual([11, 10, 0]);
  });

  it("maps a zero vector to the canvas center", () => {
    const pt = makeProj(0.5, 0.3, 20, 15, 2);
    expect(pt(0, 0, 0)).toEqual([20, 15, 0]);
  });
});

describe("radiusScale", () => {
  it("is 1 at the tuned 300px frame", () => {
    expect(radiusScale(300, 0.6)).toBe(1);
  });

  it("scales sub-linearly so small spinners stay legible", () => {
    // 20/300 linear = 0.0667; sub-linear must be larger than that
    expect(radiusScale(20, 0.6)).toBeGreaterThan(20 / 300);
  });
});

describe("paint", () => {
  function fakeCtx() {
    const calls: Array<{ x: number; y: number; r: number; fill: string }> = [];
    const ctx = {
      fillStyle: "",
      calls,
      beginPath() {},
      arc(x: number, y: number, r: number) {
        calls.push({ x, y, r, fill: this.fillStyle });
      },
      fill() {},
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  it("draws dots far→near (z ascending)", () => {
    const { ctx, calls } = fakeCtx();
    paint(ctx, [
      { x: 0, y: 0, z: 2, r: 1, white: 0.9 }, // near, light ink
      { x: 0, y: 0, z: 0, r: 1, white: 0.1 }, // far, dark ink
      { x: 0, y: 0, z: 1, r: 1, white: 0.5 },
    ], false);
    expect(calls.map((c) => c.fill)).toEqual([
      "rgba(26,26,26,1)", // z=0 first
      "rgba(128,128,128,1)",
      "rgba(230,230,230,1)", // z=2 last
    ]);
  });

  it("mirrors ink on dark themes (near dots read bright)", () => {
    const { ctx, calls } = fakeCtx();
    paint(ctx, [{ x: 0, y: 0, z: 0, r: 1, white: 0.9 }], true);
    expect(calls[0].fill).toMatch(/rgba\(25,/); // (1 - 0.9) * 255 = 26
  });

  it("skips dots with near-zero alpha", () => {
    const { ctx, calls } = fakeCtx();
    paint(ctx, [{ x: 0, y: 0, z: 0, r: 1, white: 0.5, a: 0.01 }], false);
    expect(calls.length).toBe(0);
  });
});

describe("paintLines", () => {
  function lineCtx() {
    const calls: { op: string }[] = [];
    const ctx = {
      strokeStyle: "",
      lineWidth: 1,
      calls,
      beginPath() {
        calls.push({ op: "beginPath" });
      },
      moveTo() {
        calls.push({ op: "moveTo" });
      },
      lineTo() {
        calls.push({ op: "lineTo" });
      },
      stroke() {
        calls.push({ op: "stroke" });
      },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  it("strokes one path per visible line", () => {
    const { ctx, calls } = lineCtx();
    paintLines(
      ctx,
      [{ x1: 0, y1: 0, x2: 1, y2: 1, white: 0.4, w: 0.8 }],
      false,
    );
    expect(calls).toEqual([
      { op: "beginPath" },
      { op: "moveTo" },
      { op: "lineTo" },
      { op: "stroke" },
    ]);
  });

  it("skips lines with near-zero alpha", () => {
    const { ctx, calls } = lineCtx();
    paintLines(
      ctx,
      [{ x1: 0, y1: 0, x2: 1, y2: 1, white: 0.4, w: 0.8, a: 0.01 }],
      false,
    );
    expect(calls.length).toBe(0);
  });
});
