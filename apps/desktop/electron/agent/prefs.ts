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
import { writeJsonAtomic, readJsonAsync, fileExistsAsync } from "./lib/atomic-write";
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
 * `savePrefs` / `patchPrefs` 改 async 后写入也会同步更新 cache。
 */
let cachedPrefs: ClientPrefs | null = null;

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
 * 不应出现在主进程 IPC 热路径 —— 热路径用 `getCachedPrefs()` 或 `loadPrefsAsync()`。
 */
export function loadPrefs(): ClientPrefs {
  ensureAgentDir();
  const path = prefsPath();
  let raw: RawPrefs;
  try {
    if (!existsSync(path)) {
      const defaults = { ...DEFAULT_PREFS };
      writeFileSync(path, JSON.stringify(defaults, null, 2), "utf8");
      return defaults;
    }
    raw = JSON.parse(readFileSync(path, "utf8")) as RawPrefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
  return normalizeLoadedPrefs(raw);
}

/**
 * 异步读 prefs 并填充 cache。IPC handler 写路径使用。
 */
export async function loadPrefsAsync(): Promise<ClientPrefs> {
  ensureAgentDir();
  const path = prefsPath();
  // Node 22 + ESM: 不在顶层 require,改用动态 import 不必要 —— 直接走 readJsonAsync
  try {
    const raw = await readJsonAsync<RawPrefs>(path, {} as RawPrefs);
    if (!raw || Object.keys(raw).length === 0) {
      const defaults = { ...DEFAULT_PREFS };
      cachedPrefs = defaults;
      await writeJsonAtomic(path, defaults);
      return defaults;
    }
    const normalized = normalizeLoadedPrefs(raw);
    cachedPrefs = normalized;
    return normalized;
  } catch {
    const defaults = { ...DEFAULT_PREFS };
    cachedPrefs = defaults;
    return defaults;
  }
}

/**
 * 同步读 cache(供业务主路径复用)。
 * cache 未填充(理论不会发生,bootRuntime 已预热)时同步 `loadPrefs()` 兜底。
 */
export function getCachedPrefs(): ClientPrefs {
  if (cachedPrefs) return cachedPrefs;
  const loaded = loadPrefs();
  cachedPrefs = loaded;
  return loaded;
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
    cachedPrefs = defaults;
    return { ok: true, prefs: defaults, recovered: null };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RawPrefs;
    const normalized = normalizeLoadedPrefs(raw);
    cachedPrefs = normalized;
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
    cachedPrefs = defaults;
    return {
      ok: false,
      prefs: defaults,
      recovered: { ok: false, backedUp, backupPath, error: message },
    };
  }
}

export async function savePrefs(prefs: ClientPrefs): Promise<ClientPrefs> {
  ensureAgentDir();
  cachedPrefs = prefs;
  const path = prefsPath();
  try {
    await writeJsonAtomic(path, prefs);
  } catch {
    // Windows 偶发 EPERM(目标文件被后台进程持锁);fallback 到同步写以保证
    // IPC handler 仍能完成。atomic write 已通过路径覆盖保护,我们接受这一退化。
    writeFileSync(path, JSON.stringify(prefs, null, 2), "utf8");
  }
  return prefs;
}

export async function patchPrefs(patch: Partial<ClientPrefs>): Promise<ClientPrefs> {
  const current = cachedPrefs ?? getCachedPrefs();
  const next = { ...current, ...patch };
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
  return savePrefs(next);
}

export function getAgentDirPath(): string {
  return ensureAgentDir();
}