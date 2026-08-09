/**
 * Unit tests for orb preset resolution and the wave/web frame painters.
 * Preset numbers pin the ported thinking-orbs tunings; smoke tests run
 * one deterministic frame through a fake 2D context.
 */
import { describe, expect, it } from "vitest";
import { drawWave } from "./lattice";
import { resolvePreset } from "./presets";
import { drawRibbon } from "./ribbon";
import { drawWeb } from "./web";

describe("resolvePreset", () => {
  it("resolves working at 20px with the orbits tuning", () => {
    const r = resolvePreset("working", 20);
    expect(r.mode).toBe("orbits");
    expect(r.speed).toBeCloseTo(3.9);
    expect(r.opts.orbitN).toBe(3);
    expect(r.opts.ghostN).toBe(10);
    expect(r.opts.ghostR).toBeCloseTo(2.16);
    expect(r.opts.partR).toBeCloseTo(2.88);
  });

  it("resolves listening at 20px with the wave tuning", () => {
    const r = resolvePreset("listening", 20);
    expect(r.mode).toBe("wave");
    expect(r.speed).toBeCloseTo(3.998);
    expect(r.opts.rings).toBe(5);
    expect(r.opts.lonDensity).toBe(13);
    expect(r.opts.rBase).toBeCloseTo(0.96);
    expect(r.opts.rDepth).toBeCloseTo(2.72);
  });

  it("resolves connecting at 20px with the web tuning", () => {
    const r = resolvePreset("connecting", 20);
    expect(r.mode).toBe("web");
    expect(r.speed).toBeCloseTo(6.63);
    expect(r.opts.nodeN).toBe(8);
    expect(r.opts.signals).toBe(1);
    expect(r.opts.nodeR).toBeCloseTo(2.128);
    expect(r.opts.nodeRDepth).toBeCloseTo(2.736);
  });

  it("resolves breathing at 20px with the ring tuning", () => {
    const r = resolvePreset("breathing", 20);
    expect(r.mode).toBe("ring");
    expect(r.speed).toBeCloseTo(3.78);
    // count 0.028 → both lattice sides take √scale (max 2)
    expect(r.opts.lanes).toBe(2);
    expect(r.opts.segs).toBe(15);
    // size 1.622 scales radii
    expect(r.opts.rBase).toBeCloseTo(1.7842);
    expect(r.opts.rDepth).toBeCloseTo(2.7574);
    // extras merged verbatim
    expect(r.opts.spin).toBe(0);
    expect(r.opts.bandMul).toBeCloseTo(3.968);
    expect(r.opts.wobMul).toBeCloseTo(0.565);
    // face-on ring with no ghost sphere
    expect(r.opts.faceOn).toBe(1);
    expect(r.opts.ghostN).toBe(0);
  });

  it("caches resolved presets per (state, size)", () => {
    expect(resolvePreset("working", 20)).toBe(resolvePreset("working", 20));
    expect(resolvePreset("listening", 20)).toBe(resolvePreset("listening", 20));
  });
});

describe("drawWave / drawWeb smoke", () => {
  function fakeCtx() {
    let arcs = 0;
    let moves = 0;
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      beginPath() {},
      arc() {
        arcs++;
      },
      fill() {},
      moveTo() {
        moves++;
      },
      lineTo() {},
      stroke() {},
    } as unknown as CanvasRenderingContext2D;
    return {
      ctx,
      countArcs: () => arcs,
      countMoves: () => moves,
    };
  }

  it("drawWave paints a full dot field for one frame", () => {
    const { ctx, countArcs } = fakeCtx();
    const opts = resolvePreset("listening", 20).opts;
    drawWave(ctx, 20, 0.3, true, opts);
    expect(countArcs()).toBeGreaterThan(40);
  });

  it("drawWeb paints nodes without throwing", () => {
    const { ctx, countArcs } = fakeCtx();
    const opts = resolvePreset("connecting", 20).opts;
    drawWeb(ctx, 20, 0.3, true, opts);
    // 8 nodes + at least 1 signal packet
    expect(countArcs()).toBeGreaterThanOrEqual(9);
  });

  it("drawWeb runs identically on light themes", () => {
    const { ctx, countArcs } = fakeCtx();
    const opts = resolvePreset("connecting", 64).opts;
    drawWeb(ctx, 64, 0.3, false, opts);
    expect(countArcs()).toBeGreaterThan(30);
  });

  it("drawRibbon paints the breathing ring for one frame", () => {
    const { ctx, countArcs } = fakeCtx();
    const opts = resolvePreset("breathing", 20).opts;
    drawRibbon(ctx, 20, 0.3, true, opts);
    // 8 lanes × 15 segs = 120 band dots, no ghost sphere
    expect(countArcs()).toBe(120);
  });

  it("drawRibbon runs identically on light themes", () => {
    const { ctx, countArcs } = fakeCtx();
    const opts = resolvePreset("breathing", 64).opts;
    drawRibbon(ctx, 64, 0.3, false, opts);
    expect(countArcs()).toBeGreaterThan(100);
  });
});
