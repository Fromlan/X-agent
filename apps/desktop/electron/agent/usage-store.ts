import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  TokenUsage,
  TurnUsage,
  UsageDayBucket,
  UsageModelBucket,
  UsageSummary,
} from "../../shared/ipc";
import { ensureAgentDir, getAgentDirPath } from "./prefs";

export interface UsageStoreFile {
  version: 1;
  days: Record<string, UsageDayBucket>;
}

const EMPTY_TOKENS: TokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
};

/** Test override for store file path. */
let usagePathOverride: string | null = null;

export function setUsageStorePathForTests(path: string | null): void {
  usagePathOverride = path;
}

function usagePath(): string {
  if (usagePathOverride) return usagePathOverride;
  return join(getAgentDirPath(), "x-agent-usage.json");
}

function emptyBucket(): UsageDayBucket {
  return {
    tokens: { ...EMPTY_TOKENS },
    cost: 0,
    turns: 0,
    byModel: {},
  };
}

function emptyModelBucket(): UsageModelBucket {
  return {
    tokens: { ...EMPTY_TOKENS },
    cost: 0,
    turns: 0,
  };
}

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
  };
}

/** Local calendar date YYYY-MM-DD. */
export function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function loadUsageStore(): UsageStoreFile {
  if (!usagePathOverride) ensureAgentDir();
  const path = usagePath();
  if (!existsSync(path)) {
    return { version: 1, days: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<UsageStoreFile>;
    if (!raw || raw.version !== 1 || typeof raw.days !== "object" || !raw.days) {
      return { version: 1, days: {} };
    }
    return { version: 1, days: raw.days };
  } catch {
    return { version: 1, days: {} };
  }
}

export function saveUsageStore(store: UsageStoreFile): void {
  const path = usagePath();
  if (!usagePathOverride) {
    ensureAgentDir();
    const dir = getAgentDirPath();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
}

export function modelUsageKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

/**
 * Record one successful assistant turn into the local daily aggregate.
 */
export function recordTurnUsage(
  modelKey: string,
  usage: TurnUsage,
  dateKey: string = localDateKey(),
): UsageStoreFile {
  const store = loadUsageStore();
  const day = store.days[dateKey] ?? emptyBucket();
  day.tokens = addTokens(day.tokens, usage.tokens);
  day.cost += usage.cost.total;
  day.turns += 1;

  const model = day.byModel[modelKey] ?? emptyModelBucket();
  model.tokens = addTokens(model.tokens, usage.tokens);
  model.cost += usage.cost.total;
  model.turns += 1;
  day.byModel[modelKey] = model;

  store.days[dateKey] = day;
  saveUsageStore(store);
  return store;
}

function sumBuckets(buckets: UsageModelBucket[]): UsageModelBucket {
  const out = emptyModelBucket();
  for (const b of buckets) {
    out.tokens = addTokens(out.tokens, b.tokens);
    out.cost += b.cost;
    out.turns += b.turns;
  }
  return out;
}

/**
 * Summarize the last `days` calendar days (inclusive of today).
 * Default 30.
 */
export function getUsageSummary(options?: {
  days?: number;
}): UsageSummary {
  const n = Math.max(1, Math.min(366, options?.days ?? 30));
  const store = loadUsageStore();
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const dayRows: Array<{ date: string } & UsageDayBucket> = [];
  const modelAcc = new Map<string, UsageModelBucket>();

  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - (n - 1 - i));
    const key = localDateKey(d);
    const bucket = store.days[key];
    if (!bucket) continue;
    dayRows.push({
      date: key,
      tokens: { ...bucket.tokens },
      cost: bucket.cost,
      turns: bucket.turns,
      byModel: { ...bucket.byModel },
    });
    for (const [mk, mb] of Object.entries(bucket.byModel)) {
      const acc = modelAcc.get(mk) ?? emptyModelBucket();
      acc.tokens = addTokens(acc.tokens, mb.tokens);
      acc.cost += mb.cost;
      acc.turns += mb.turns;
      modelAcc.set(mk, acc);
    }
  }

  const byModel = [...modelAcc.entries()]
    .map(([modelKey, b]) => ({ modelKey, ...b }))
    .sort((a, b) => b.cost - a.cost || b.turns - a.turns);

  return {
    days: dayRows,
    byModel,
    totals: sumBuckets(byModel),
  };
}

export function clearUsageSummary(): { ok: boolean; error?: string } {
  try {
    saveUsageStore({ version: 1, days: {} });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Exported for tests — path to the usage file. */
export function getUsageStorePath(): string {
  return usagePath();
}
