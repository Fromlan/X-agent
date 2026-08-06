import { join } from "node:path";
import type {
  TokenUsage,
  TurnUsage,
  UsageDayBucket,
  UsageModelBucket,
  UsageSummary,
} from "../../shared/ipc";
import { ensureAgentDir, getAgentDirPath } from "./prefs";
import { createStore, type Store } from "./lib/store";

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

/** 模块级 store —— 读-改-写整体在 per-path 锁内,并发 turn 不丢累加。 */
const usageStore: Store<UsageStoreFile> = createStore<UsageStoreFile>({
  // 惰性路径:测试经 setUsageStorePathForTests 切换后缓存自动失效。
  filePath: () => usagePath(),
  defaults: { version: 1, days: {} },
  decode: decodeUsageStore,
});

/** 校验并解码盘上 usage JSON;形状不符 / 损坏时回退空 store(与旧 loadStore 一致)。 */
function decodeUsageStore(raw: unknown): UsageStoreFile {
  const r = raw as Partial<UsageStoreFile> | null;
  if (!r || r.version !== 1 || typeof r.days !== "object" || !r.days) {
    return { version: 1, days: {} };
  }
  return { version: 1, days: r.days };
}

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

/** 同步读 usage(供 IPC 启动/单测);缓存为空时同步读盘兜底。 */
export function loadUsageStore(): UsageStoreFile {
  if (!usagePathOverride) ensureAgentDir();
  return usageStore.read();
}

/** 异步读 usage 并填 cache。 */
export async function loadUsageStoreAsync(): Promise<UsageStoreFile> {
  if (!usagePathOverride) ensureAgentDir();
  return usageStore.reload();
}

/** 异步原子写入 usage。锁内整体替换,与 recordTurnUsage 互斥不丢并发 turn。 */
export async function saveUsageStore(store: UsageStoreFile): Promise<void> {
  if (!usagePathOverride) ensureAgentDir();
  await usageStore.write(store);
}

export function modelUsageKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

/**
 * Record one successful assistant turn into the local daily aggregate (async).
 * 并发安全:整个读-改-写循环在 Store 锁内,每个 turn 都基于最新落盘值累加。
 */
export async function recordTurnUsage(
  modelKey: string,
  usage: TurnUsage,
  dateKey: string = localDateKey(),
): Promise<UsageStoreFile> {
  if (!usagePathOverride) ensureAgentDir();
  return usageStore.mutate((store) => {
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
    return store;
  });
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
    await usageStore.mutate(() => ({ version: 1, days: {} }));
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