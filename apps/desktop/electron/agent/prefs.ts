import { homedir } from "node:os";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  ClientPrefs,
  DEFAULT_PREFS,
  normalizeThemePrefs,
} from "../../shared/ipc";
import { normalizeGodotDocsBranch } from "./godot-docs-cache";

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
  const rawAutoCompact = rest.autoCompactPercent;
  const autoCompactPercent =
    typeof rawAutoCompact === "number" &&
    Number.isFinite(rawAutoCompact) &&
    rawAutoCompact >= 0
      ? Math.min(100, Math.floor(rawAutoCompact))
      : DEFAULT_PREFS.autoCompactPercent;
  const { themeId, colorMode } = normalizeThemePrefs(raw);
  return {
    ...DEFAULT_PREFS,
    ...rest,
    themeId,
    colorMode,
    hiddenProjectKeys,
    dismissedReadyChecklistKeys,
    dismissedGodotToolsNudgeKeys,
    autoCompactPercent,
    godotDocsBranch: normalizeGodotDocsBranch(
      typeof rest.godotDocsBranch === "string"
        ? rest.godotDocsBranch
        : DEFAULT_PREFS.godotDocsBranch,
    ),
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
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 加载偏好。原始实现：JSON 损坏时返回 DEFAULT_PREFS，**不**覆盖文件。
 * 主进程应优先使用 {@link loadPrefsWithRecovery} 以获取 backup / 错误通知。
 */
export function loadPrefs(): ClientPrefs {
  ensureAgentDir();
  const path = prefsPath();
  if (!existsSync(path)) {
    const defaults = { ...DEFAULT_PREFS };
    writeFileSync(path, JSON.stringify(defaults, null, 2), "utf8");
    return defaults;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RawPrefs;
    return normalizeLoadedPrefs(raw);
  } catch {
    // 兼容旧行为：损坏时返回默认值,但**不**写回。
    // 主进程应优先使用 {@link loadPrefsWithRecovery}。
    return { ...DEFAULT_PREFS };
  }
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
 * 安全加载偏好:解析失败时将损坏文件备份到 `x-agent.json.broken-<ISO>.bak`,
 * 返回 recovery 提示,**不**写回任何新内容(除非文件不存在)。
 * 调用方可选择把 recovery 信息写进 IPC 状态 / 日志。
 */
export function loadPrefsWithRecovery(): PrefsLoadResult {
  ensureAgentDir();
  const path = prefsPath();
  if (!existsSync(path)) {
    const defaults = { ...DEFAULT_PREFS };
    writeFileSync(path, JSON.stringify(defaults, null, 2), "utf8");
    return { ok: true, prefs: defaults, recovered: null };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RawPrefs;
    return {
      ok: true,
      prefs: normalizeLoadedPrefs(raw),
      recovered: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 备份损坏文件,避免后续写入覆盖原内容。
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
      // 备份失败时也不要让坏文件被覆盖:直接返回默认值,不写回。
      console.warn(
        `[prefs] Failed to parse ${path} (${message}); backup also failed: ${
          backupErr instanceof Error ? backupErr.message : String(backupErr)
        }`,
      );
    }
    return {
      ok: false,
      prefs: { ...DEFAULT_PREFS },
      recovered: { ok: false, backedUp, backupPath, error: message },
    };
  }
}

export function savePrefs(prefs: ClientPrefs): ClientPrefs {
  ensureAgentDir();
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), "utf8");
  return prefs;
}

export function patchPrefs(patch: Partial<ClientPrefs>): ClientPrefs {
  const next = { ...loadPrefs(), ...patch };
  if (typeof patch.godotDocsBranch === "string") {
    next.godotDocsBranch = normalizeGodotDocsBranch(patch.godotDocsBranch);
  }
  if (typeof patch.autoCompactPercent === "number") {
    next.autoCompactPercent = Number.isFinite(patch.autoCompactPercent)
      ? Math.min(100, Math.max(0, Math.floor(patch.autoCompactPercent)))
      : DEFAULT_PREFS.autoCompactPercent;
  }
  return savePrefs(next);
}

export function getAgentDirPath(): string {
  return ensureAgentDir();
}
