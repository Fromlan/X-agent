/**
 * Vitest suite for `auto-maintain.ts` — covers the snip-first / compact-fallback
 * flow, the debounce, and the disabled / below-threshold short-circuits.
 *
 * Uses a hand-rolled fake `AgentSession` to avoid pulling in Pi's runtime.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  autoMaintain,
  __resetAutoMaintainState,
  type AutoMaintainReport,
} from "./auto-maintain";
import type { ClientPrefs } from "../../shared/ipc";

type ToolResultMsg = {
  role: "toolResult";
  content: Array<{ type: "text"; text: string }>;
  snipped?: unknown;
  [k: string]: unknown;
};

function makeSessionFixture(opts: {
  messages?: unknown[];
  percent?: number;
  contextWindow?: number;
  compactImpl?: () => Promise<{ tokensBefore: number; estimatedTokensAfter: number }>;
}) {
  const messages: unknown[] = opts.messages ?? [];
  const session = {
    messages,
    isCompacting: false,
    getContextUsage: () => {
      const w = opts.contextWindow ?? 200_000;
      const t = (opts.percent ?? 0) * w / 100;
      return { tokens: t, contextWindow: w };
    },
    compact: opts.compactImpl ?? (async () => ({
      tokensBefore: 0,
      estimatedTokensAfter: 0,
    })),
  };
  return { session, messages };
}

const PREFS_80: ClientPrefs = {
  autoCompactPercent: 80,
  autoSnipThreshold: 8192,
  autoSnipHeadKeep: 4096,
  autoSnipTailKeep: 1024,
};

describe("autoMaintain", () => {
  beforeEach(() => {
    __resetAutoMaintainState();
  });
  afterEach(() => {
    __resetAutoMaintainState();
  });

  it("returns 'disabled' when autoCompactPercent is 0", async () => {
    const { session } = makeSessionFixture({ percent: 99 });
    const r = await autoMaintain(session as never, {
      ...PREFS_80,
      autoCompactPercent: 0,
    });
    expect(r.outcome).toBe("disabled");
    expect(r.snip.snippedCount).toBe(0);
  });

  it("returns 'below-threshold' when occupancy is under the trigger", async () => {
    const { session } = makeSessionFixture({ percent: 50 });
    const r = await autoMaintain(session as never, PREFS_80);
    expect(r.outcome).toBe("below-threshold");
    expect(r.percentBefore).toBe(50);
  });

  it("returns 'no-context-info' when getContextUsage is unavailable", async () => {
    const session = {
      messages: [],
      isCompacting: false,
      getContextUsage: () => null,
      compact: async () => ({ tokensBefore: 0, estimatedTokensAfter: 0 }),
    };
    const r = await autoMaintain(session as never, PREFS_80);
    expect(r.outcome).toBe("no-context-info");
  });

  it("snip alone can clear pressure — outcome is 'snip-cleared' without compact", async () => {
    const big = "x".repeat(50_000);
    const messages: ToolResultMsg[] = [
      {
        role: "toolResult",
        content: [{ type: "text", text: big }],
      },
    ];
    const { session } = makeSessionFixture({
      messages,
      // Before snip: 90% over threshold. After snip we clamp `percent` by
      // re-reading — fake a drop to 40% to simulate "snip cleared pressure".
      percent: 90,
      contextWindow: 200_000,
    });
    // Mutate fixture so the second readContextUsage returns a low percent.
    let read = 0;
    (session as { getContextUsage: () => unknown }).getContextUsage = () => {
      read += 1;
      return {
        tokens: read === 1 ? 180_000 : 80_000,
        contextWindow: 200_000,
      };
    };
    const r: AutoMaintainReport = await autoMaintain(session as never, PREFS_80);
    expect(r.outcome).toBe("snip-cleared");
    expect(r.snip.snippedCount).toBe(1);
    expect(r.percentBefore).toBe(90);
    expect(r.percentAfter).toBe(40);
  });

  it("compacts when snip alone is not enough", async () => {
    const big = "x".repeat(80_000);
    const messages: ToolResultMsg[] = [
      {
        role: "toolResult",
        content: [{ type: "text", text: big }],
      },
    ];
    let compactCalled = 0;
    let read = 0;
    const { session } = makeSessionFixture({
      messages,
      percent: 95,
      contextWindow: 200_000,
      compactImpl: async () => {
        compactCalled += 1;
        return { tokensBefore: 190_000, estimatedTokensAfter: 30_000 };
      },
    });
    (session as { getContextUsage: () => unknown }).getContextUsage = () => {
      read += 1;
      // stays high after snip too (snip removed less than 30%)
      return { tokens: 170_000, contextWindow: 200_000 };
    };
    const r = await autoMaintain(session as never, PREFS_80);
    expect(compactCalled).toBe(1);
    expect(r.outcome).toBe("snipped-and-compacted");
    expect(r.compactFreedTokens).toBe(160_000);
  });

  it("debounces a second call within 5s of the first", async () => {
    const big = "x".repeat(80_000);
    const messages: ToolResultMsg[] = [
      { role: "toolResult", content: [{ type: "text", text: big }] },
    ];
    let now = 1_000_000;
    let compactCalled = 0;
    const { session } = makeSessionFixture({
      messages,
      percent: 90,
      compactImpl: async () => {
        compactCalled += 1;
        return { tokensBefore: 0, estimatedTokensAfter: 0 };
      },
    });
    const r1 = await autoMaintain(session as never, PREFS_80, {
      now: () => now,
    });
    expect(compactCalled).toBe(1);
    expect(r1.outcome).not.toBe("debounced");
    now += 1_000; // 1s later
    const r2 = await autoMaintain(session as never, PREFS_80, {
      now: () => now,
    });
    expect(r2.outcome).toBe("debounced");
    now += 10_000; // 11s later — past debounce
    const r3 = await autoMaintain(session as never, PREFS_80, {
      now: () => now,
    });
    expect(r3.outcome).not.toBe("debounced");
  });

  it("returns 'session-busy' when session.isCompacting is already true", async () => {
    const messages: ToolResultMsg[] = [
      { role: "toolResult", content: [{ type: "text", text: "x".repeat(50_000) }] },
    ];
    const session = {
      messages,
      isCompacting: true,
      getContextUsage: () => ({ tokens: 180_000, contextWindow: 200_000 }),
      compact: async () => ({ tokensBefore: 0, estimatedTokensAfter: 0 }),
    };
    const r = await autoMaintain(session as never, PREFS_80);
    expect(r.outcome).toBe("session-busy");
  });

  it("returns 'compact-failed' when session.compact throws", async () => {
    const messages: ToolResultMsg[] = [
      { role: "toolResult", content: [{ type: "text", text: "x".repeat(80_000) }] },
    ];
    const session = {
      messages,
      isCompacting: false,
      getContextUsage: () => ({ tokens: 180_000, contextWindow: 200_000 }),
      compact: async () => {
        throw new Error("model unreachable");
      },
    };
    const r = await autoMaintain(session as never, PREFS_80);
    expect(r.outcome).toBe("compact-failed");
    expect(r.detail).toContain("model unreachable");
  });
});
