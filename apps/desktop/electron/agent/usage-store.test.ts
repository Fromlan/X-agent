/**
 * Vitest 套件 —— 覆盖 ROADMAP 1.1 首批关键模块迁移：usage-store。
 *
 * 与 `scripts/test-usage-store.ts`（离线断言脚本）并存：
 * - 旧脚本：CI 必跑，快速冒烟
 * - 新套件：开发者本地 `npm run test:unit` 跑，享受 watch / coverage / IDE 集成
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnUsage } from "../../shared/ipc";
import {
  clearUsageSummary,
  getUsageSummary,
  loadUsageStoreAsync,
  localDateKey,
  modelUsageKey,
  recordTurnUsage,
  setUsageStorePathForTests,
} from "./usage-store";

const TURN: TurnUsage = {
  tokens: {
    input: 100,
    output: 50,
    cacheRead: 10,
    cacheWrite: 5,
    total: 165,
  },
  cost: {
    input: 0.01,
    output: 0.02,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0.03,
  },
};

let dir: string;

function useTempUsageStore(): void {
  dir = mkdtempSync(join(tmpdir(), "x-agent-usage-vitest-"));
  setUsageStorePathForTests(join(dir, "x-agent-usage.json"));
}

afterEach(() => {
  setUsageStorePathForTests(null);
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = "";
  }
});

describe("usage-store", () => {
  it("recordTurnUsage 累加当日与按模型分桶", async () => {
    useTempUsageStore();
    const keyA = modelUsageKey("openai", "gpt-test");
    const keyB = modelUsageKey("anthropic", "claude-test");
    const today = localDateKey();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = localDateKey(yesterdayDate);

    await recordTurnUsage(keyA, TURN, today);
    await recordTurnUsage(keyA, TURN, today);
    await recordTurnUsage(keyB, TURN, yesterday);

    const store = await loadUsageStoreAsync();
    expect(store.days[today]?.turns).toBe(2);
    expect(store.days[today]?.byModel[keyA]?.turns).toBe(2);
    expect(store.days[today]?.tokens.total).toBe(330);
    expect(Math.abs((store.days[today]?.cost ?? 0) - 0.06)).toBeLessThan(1e-9);
    expect(store.days[yesterday]?.turns).toBe(1);
    expect(store.days[yesterday]?.byModel[keyB]?.turns).toBe(1);
  });

  it("getUsageSummary 汇总最近 N 天", async () => {
    useTempUsageStore();
    const keyA = modelUsageKey("openai", "gpt-test");
    const keyB = modelUsageKey("anthropic", "claude-test");
    const today = localDateKey();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = localDateKey(yesterdayDate);

    await recordTurnUsage(keyA, TURN, today);
    await recordTurnUsage(keyA, TURN, today);
    await recordTurnUsage(keyB, TURN, yesterday);

    const summary = await getUsageSummary({ days: 30 });
    expect(summary.totals.turns).toBe(3);
    expect(summary.totals.tokens.total).toBe(495);
    expect(summary.byModel).toHaveLength(2);
    const a = summary.byModel.find((m) => m.modelKey === keyA);
    const b = summary.byModel.find((m) => m.modelKey === keyB);
    expect(a?.turns).toBe(2);
    expect(b?.turns).toBe(1);
    expect(summary.days.some((d) => d.date === today)).toBe(true);
    expect(summary.days.some((d) => d.date === yesterday)).toBe(true);
  });

  it("clearUsageSummary 清空后为空", async () => {
    useTempUsageStore();
    await recordTurnUsage(modelUsageKey("openai", "gpt-test"), TURN);
    const cleared = await clearUsageSummary();
    expect(cleared.ok).toBe(true);
    const empty = await loadUsageStoreAsync();
    expect(Object.keys(empty.days)).toHaveLength(0);
    const emptySummary = await getUsageSummary({ days: 30 });
    expect(emptySummary.totals.turns).toBe(0);
  });

  it("localDateKey 返回 YYYY-MM-DD", () => {
    const key = localDateKey(new Date(2024, 0, 5));
    expect(key).toBe("2024-01-05");
  });

  it("损坏文件回退为空 store", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "x-agent-usage-bad-"));
    try {
      setUsageStorePathForTests(join(dir2, "x-agent-usage.json"));
      const store = await loadUsageStoreAsync();
      expect(store.version).toBe(1);
      expect(Object.keys(store.days)).toHaveLength(0);
    } finally {
      setUsageStorePathForTests(null);
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
