import { join } from "node:path";
import { readFileSync } from "node:fs";
import type {
  TokenUsage,
  TurnUsage,
  UsageDayBucket,
  UsageModelBucket,
  UsageSummary,
} from "../../shared/ipc";
import { ensureAgentDir, getAgentDirPath } from "./prefs";
import { readJsonAsync, writeJsonAtomic } from "./lib/atomic-write";
import { withStoreLock } from "./lib/store-mutex";

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

/** 模块级 cache —— 由 withStoreLock 串行化所有写。 */
let storeCache: UsageStoreFile | null = null;

export function setUsageStorePathForTests(path: string | null): void {
  usagePathOverride = path;
  storeCache = null;
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

/** 同步读 usage(供 IPC 启动/单测)。 */
export function loadUsageStore(): UsageStoreFile {
  if (storeCache) return storeCache;
  if (!usagePathOverride) ensureAgentDir();
  const path = usagePath();
  let raw: Partial<UsageStoreFile>;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as Partial<UsageStoreFile>;
  } catch {
    const empty: UsageStoreFile = { version: 1, days: {} };
    storeCache = empty;
    return empty;
  }
  if (!raw || raw.version !== 1 || typeof raw.days !== "object" || !raw.days) {
    const empty: UsageStoreFile = { version: 1, days: {} };
    storeCache = empty;
    return empty;
  }
  const loaded: UsageStoreFile = { version: 1, days: raw.days };
  storeCache = loaded;
  return loaded;
}

/** 异步读 usage 并填 cache。 */
export async function loadUsageStoreAsync(): Promise<UsageStoreFile> {
  if (storeCache) return storeCache;
  if (!usagePathOverride) ensureAgentDir();
  const path = usagePath();
  const raw = await readJsonAsync<Partial<UsageStoreFile>>(path, {});
  if (!raw || raw.version !== 1 || typeof raw.days !== "object" || !raw.days) {
    const empty: UsageStoreFile = { version: 1, days: {} };
    storeCache = empty;
    return empty;
  }
  const loaded: UsageStoreFile = { version: 1, days: raw.days };
  storeCache = loaded;
  return loaded;
}

/** 异步原子写入 usage。串行到 withStoreLock 保证不丢并发 turn。 */
export async function saveUsageStore(store: UsageStoreFile): Promise<void> {
  if (!usagePathOverride) ensureAgentDir();
  storeCache = store;
  const path = usagePath();
  await withStoreLock(path, () => writeJsonAtomic(path, store));
}

export function modelUsageKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

/**
 * Record one successful assistant turn into the local daily aggregate (async).
 * 并发安全:由 writeQueue 串行化 read-modify-write。
 */
export async function recordTurnUsage(
  modelKey: string,
  usage: TurnUsage,
  dateKey: string = localDateKey(),
): Promise<UsageStoreFile> {
  const store = await loadUsageStoreAsync();
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
  await saveUsageStore(store);
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
export async function getUsageSummary(options?: {
  days?: number;
}): Promise<UsageSummary> {
  const n = Math.max(1, Math.min(366, options?.days ?? 30));
  const store = await loadUsageStoreAsync();
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

export async function clearUsageSummary(): Promise<{ ok: boolean; error?: string }> {
  try {
    await saveUsageStore({ version: 1, days: {} });
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