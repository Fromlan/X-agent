import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { createStore, type Store } from "./lib/store";
import {
  ClientPrefs,
  DEFAULT_PREFS,
  normalizeThemePrefs,
} from "../../shared/ipc";

type RawPrefs = Partial<ClientPrefs> & {
  language?: unknown;
  /** @deprecated Prefer themeId + colorMode */
  theme?: unknown;
  /** @deprecated Removed Gitee dual update source */
  updateSource?: unknown;
};

/** Test-only override for ~/.pi/agent (absolute path). */
let agentDirOverride: string | null = null;

/** @internal Used by offline tests to isolate prefs I/O. */
export function setAgentDirOverrideForTests(dir: string | null): void {
  agentDirOverride = dir;
}

/**
 * 启动期同步预热的 prefs cache (filled by `loadPrefsWithRecovery` during boot)。
 * 业务热路径 IPC handler 全部走 `getCachedPrefs()` 同步读 cache,避免 IPC 延迟;
 * `patchPrefs` 走 Store.mutate,写入后同步更新 cache。
 */
const store: Store<ClientPrefs> = createStore<ClientPrefs>({
  // 惰性路径:测试经 setAgentDirOverrideForTests 切换目录后自动失效缓存。
  filePath: () => prefsPath(),
  defaults: { ...DEFAULT_PREFS },
  decode: (raw) => normalizeLoadedPrefs(raw as RawPrefs),
  onWriteError: (_err, value) => {
    // Windows 偶发 EPERM(目标文件被后台进程持锁);fallback 到同步写以保证
    // IPC handler 仍能完成。atomic write 已通过路径覆盖保护,我们接受这一退化。
    writeFileSync(prefsPath(), JSON.stringify(value, null, 2), "utf8");
  },
});

function normalizeLoadedPrefs(raw: RawPrefs): ClientPrefs {
  const {
    language: _legacyLanguage,
    theme: _legacyTheme,
    updateSource: _legacyUpdateSource,
    ...rest
  } = raw;
  const hiddenProjectKeys = Array.isArray(rest.hiddenProjectKeys)
    ? rest.hiddenProjectKeys.filter(
        (k): k is string => typeof k === "string" && k.trim().length > 0,
      )
    : [];
  const dismissedReadyChecklistKeys = Array.isArray(
    rest.dismissedReadyChecklistKeys,
  )
    ? rest.dismissedReadyChecklistKeys.filter(
        (k): k is string => typeof k === "string" && k.trim().length > 0,
      )
    : [];
  const dismissedGodotToolsNudgeKeys = Array.isArray(
    rest.dismissedGodotToolsNudgeKeys,
  )
    ? rest.dismissedGodotToolsNudgeKeys.filter(
        (k): k is string => typeof k === "string" && k.trim().length > 0,
      )
    : [];
  const disabledSkills = Array.isArray(rest.disabledSkills)
    ? rest.disabledSkills
        .filter((k): k is string => typeof k === "string")
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
    : [];
  const rawAutoCompact = rest.autoCompactPercent;
  const autoCompactPercent =
    typeof rawAutoCompact === "number" &&
    Number.isFinite(rawAutoCompact) &&
    rawAutoCompact >= 0
      ? Math.min(100, Math.floor(rawAutoCompact))
      : DEFAULT_PREFS.autoCompactPercent;
  const rawGoalMax = rest.goalMaxTurns;
  const goalMaxTurns =
    typeof rawGoalMax === "number" &&
    Number.isFinite(rawGoalMax) &&
    rawGoalMax >= 1
      ? Math.min(200, Math.floor(rawGoalMax))
      : DEFAULT_PREFS.goalMaxTurns;
  const rawGoalTokens = rest.goalMaxTokens;
  const goalMaxTokens =
    typeof rawGoalTokens === "number" &&
    Number.isFinite(rawGoalTokens) &&
    rawGoalTokens >= 10_000
      ? Math.min(10_000_000, Math.floor(rawGoalTokens))
      : DEFAULT_PREFS.goalMaxTokens;
  const { themeId, colorMode } = normalizeThemePrefs(raw);
  return {
    ...DEFAULT_PREFS,
    ...rest,
    themeId,
    colorMode,
    hiddenProjectKeys,
    dismissedReadyChecklistKeys,
    dismissedGodotToolsNudgeKeys,
    disabledSkills,
    autoCompactPercent,
    goalMaxTurns,
    goalMaxTokens,
  };
}

function agentDir(): string {
  return agentDirOverride ?? join(homedir(), ".pi", "agent");
}

function prefsPath(): string {
  return join(agentDir(), "x-agent.json");
}

export function ensureAgentDir(): string {
  const dir = agentDir();
  if (!dir.includes("/") && !dir.includes("\\")) return dir;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // EEXIST 等忽略;幂等 mkdir
  }
  return dir;
}

/**
 * 同步读 prefs,启动预热与单测兼容入口。
 * 不应出现在主进程 IPC 热路径 —— 热路径用 `getCachedPrefs()`。
 */
export function loadPrefs(): ClientPrefs {
  ensureAgentDir();
  const path = prefsPath();
  let raw: RawPrefs;
  try {
    if (!existsSync(path)) {
      const defaults = { ...DEFAULT_PREFS };
      writeFileSync(path, JSON.stringify(defaults, null, 2), "utf8");
      store.prime(defaults);
      return defaults;
    }
    raw = JSON.parse(readFileSync(path, "utf8")) as RawPrefs;
  } catch {
    const defaults = { ...DEFAULT_PREFS };
    store.prime(defaults);
    return defaults;
  }
  const normalized = normalizeLoadedPrefs(raw);
  store.prime(normalized);
  return normalized;
}

/**
 * 同步读 cache(供业务主路径复用)。
 * cache 未填充(理论不会发生,bootRuntime 已预热)时同步读盘兜底。
 */
export function getCachedPrefs(): ClientPrefs {
  return store.read();
}

export type PrefsRecoveryNotice = {
  /** 用户文件无法解析 */
  ok: false;
  /** 是否已备份损坏文件 */
  backedUp: boolean;
  /** 备份路径(若成功) */
  backupPath?: string;
  /** 解析错误的简短信息 */
  error: string;
};

export type PrefsLoadResult =
  | { ok: true; prefs: ClientPrefs; recovered: null }
  | { ok: false; prefs: ClientPrefs; recovered: PrefsRecoveryNotice };

/**
 * 启动期一次性同步预热 prefs + cache。
 * 解析失败时把损坏文件备份到 `x-agent.json.broken-<ISO>.bak`,
 * 返回 recovery 提示,不写回任何新内容(除非文件不存在)。
 */
export function loadPrefsWithRecovery(): PrefsLoadResult {
  ensureAgentDir();
  const path = prefsPath();
  if (!existsSync(path)) {
    const defaults = { ...DEFAULT_PREFS };
    writeFileSync(path, JSON.stringify(defaults, null, 2), "utf8");
    store.prime(defaults);
    return { ok: true, prefs: defaults, recovered: null };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RawPrefs;
    const normalized = normalizeLoadedPrefs(raw);
    store.prime(normalized);
    return {
      ok: true,
      prefs: normalized,
      recovered: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let backedUp = false;
    let backupPath: string | undefined;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = `${path}.broken-${stamp}.bak`;
      renameSync(path, backupPath);
      backedUp = true;
      console.warn(
        `[prefs] Failed to parse ${path} (${message}); backed up to ${backupPath}`,
      );
    } catch (backupErr) {
      console.warn(
        `[prefs] Failed to parse ${path} (${message}); backup also failed: ${
          backupErr instanceof Error ? backupErr.message : String(backupErr)
        }`,
      );
    }
    const defaults = { ...DEFAULT_PREFS };
    store.prime(defaults);
    return {
      ok: false,
      prefs: defaults,
      recovered: { ok: false, backedUp, backupPath, error: message },
    };
  }
}

export async function patchPrefs(patch: Partial<ClientPrefs>): Promise<ClientPrefs> {
  ensureAgentDir();
  // 整个读-改-写循环在 per-path 锁内(Store.mutate):并发 patch 不会读到同一
  // 旧 base 后互相覆盖;clamp / 归一化随 fn 在锁内计算,结果同步写盘并刷新 cache。
  return store.mutate((prev) => {
    const next = { ...prev, ...patch };
    if (typeof patch.autoCompactPercent === "number") {
      next.autoCompactPercent = Number.isFinite(patch.autoCompactPercent)
        ? Math.min(100, Math.max(0, Math.floor(patch.autoCompactPercent)))
        : DEFAULT_PREFS.autoCompactPercent;
    }
    if (typeof patch.goalMaxTurns === "number") {
      next.goalMaxTurns = Number.isFinite(patch.goalMaxTurns)
        ? Math.min(200, Math.max(1, Math.floor(patch.goalMaxTurns)))
        : DEFAULT_PREFS.goalMaxTurns;
    }
    if (typeof patch.goalMaxTokens === "number") {
      next.goalMaxTokens = Number.isFinite(patch.goalMaxTokens)
        ? Math.min(10_000_000, Math.max(10_000, Math.floor(patch.goalMaxTokens)))
        : DEFAULT_PREFS.goalMaxTokens;
    }
    if (patch.disabledSkills !== undefined) {
      next.disabledSkills = Array.isArray(patch.disabledSkills)
        ? patch.disabledSkills
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim())
            .filter((k) => k.length > 0)
        : [];
    }
    return next;
  });
}

export function getAgentDirPath(): string {
  return ensureAgentDir();
}