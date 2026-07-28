import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnUsage } from "../shared/ipc";
import {
  clearUsageSummary,
  getUsageSummary,
  loadUsageStore,
  localDateKey,
  modelUsageKey,
  recordTurnUsage,
  setUsageStorePathForTests,
} from "../electron/agent/usage-store";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const dir = mkdtempSync(join(tmpdir(), "x-agent-usage-"));
const usageFile = join(dir, "x-agent-usage.json");
setUsageStorePathForTests(usageFile);

try {
  const turn: TurnUsage = {
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

  const keyA = modelUsageKey("openai", "gpt-test");
  const keyB = modelUsageKey("anthropic", "claude-test");
  const today = localDateKey();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = localDateKey(yesterdayDate);

  recordTurnUsage(keyA, turn, today);
  recordTurnUsage(keyA, turn, today);
  recordTurnUsage(keyB, turn, yesterday);

  const store = loadUsageStore();
  assert(store.days[today]?.turns === 2, "today 2 turns");
  assert(store.days[today]?.byModel[keyA]?.turns === 2, "model A 2 turns");
  assert(store.days[today]?.tokens.total === 330, "today tokens sum");
  assert(
    Math.abs((store.days[today]?.cost ?? 0) - 0.06) < 1e-9,
    "today cost sum",
  );
  assert(store.days[yesterday]?.turns === 1, "yesterday 1 turn");
  assert(
    store.days[yesterday]?.byModel[keyB]?.turns === 1,
    "model B yesterday",
  );

  const summary = getUsageSummary({ days: 30 });
  assert(summary.totals.turns === 3, "summary turns");
  assert(summary.totals.tokens.total === 495, "summary tokens");
  assert(summary.byModel.length === 2, "two models");
  const a = summary.byModel.find((m) => m.modelKey === keyA);
  const b = summary.byModel.find((m) => m.modelKey === keyB);
  assert(a?.turns === 2, "summary model A");
  assert(b?.turns === 1, "summary model B");
  assert(summary.days.some((d) => d.date === today), "includes today");
  assert(summary.days.some((d) => d.date === yesterday), "includes yesterday");

  const cleared = clearUsageSummary();
  assert(cleared.ok, "clear ok");
  const empty = loadUsageStore();
  assert(Object.keys(empty.days).length === 0, "days cleared");
  const emptySummary = getUsageSummary({ days: 30 });
  assert(emptySummary.totals.turns === 0, "empty summary");
} finally {
  setUsageStorePathForTests(null);
  rmSync(dir, { recursive: true, force: true });
}

console.log("test-usage-store: ok");
