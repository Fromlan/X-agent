import { access, mkdir, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BashCheckResult } from "../../shared/ipc";
import { mutatePiSettingsSync } from "./pi-settings";

const execFileAsync = promisify(execFile);

const CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

function settingsPath(): string {
  return join(homedir(), ".pi", "agent", "settings.json");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readSettings(): Promise<{ shellPath?: string }> {
  try {
    const raw = await readFile(settingsPath(), "utf8");
    return JSON.parse(raw) as { shellPath?: string };
  } catch {
    return {};
  }
}

async function whichBashOnPath(): Promise<string | null> {
  const pathEnv = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exeName = process.platform === "win32" ? "bash.exe" : "bash";
  for (const part of pathEnv.split(sep)) {
    const candidate = join(part.trim(), exeName);
    if (!(await fileExists(candidate))) continue;
    // 不仅是文件存在：必须真的输出 GNU bash banner，避免被 nvm-symlinked
    // 之类把 `bash.exe` 借成 node shim 的目录误抓（#24 PR 提到的 pre-existing
    // bash-check flake 多数是这种 PATH shim 导致）。CANDIDATES 那批已知是真
    // bash，不用再 probe；这里是 PATH 兜底路径才需要。
    const probe = await probeBash(candidate);
    if (probe.ok) return candidate;
  }
  return null;
}

export async function findSuggestedBash(): Promise<string | null> {
  for (const candidate of CANDIDATES) {
    if (await fileExists(candidate)) return candidate;
  }
  return whichBashOnPath();
}

/**
 * 验证路径是否实际可执行 bash：要求 `--version` 退出 0 且 stdout 包含
 * 真实 GNU Bash 特征（任何被编译进 bash 的字符串，避免被伪装 exe 蒙混过关）。
 * 返回更丰富的诊断结果，便于 renderer 指出「不是 bash」或「无法执行」。
 */
type ProbeResult =
  | { ok: true; stdout: string }
  | { ok: false; reason: "spawn_failed" | "no_banner" | "timeout" };

type ProbeFailureReason = "spawn_failed" | "no_banner" | "timeout";

const BASH_BANNER_PATTERNS: readonly RegExp[] = [
  /\bGNU bash,\s*version\b/i,
  /\bGNU bash\b/i,
  /bash-\d+\.\d+/,
];

async function probeBash(target: string): Promise<ProbeResult> {
  let stdout = "";
  try {
    // timeout 留到 5s:Windows 11 自带的 C:\Windows\system32\bash.exe 是 WSL
    // 转发器,cold start 一次需要 ~2.2s (WSL infrastructure 初始化),2s 不够。
    // CANDIDATES 那批 (Git for Windows) 不会触发 cold start,生产路径无影响。
    const result = await execFileAsync(target, ["--version"], { timeout: 5000 });
    stdout = result.stdout ?? "";
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    if (code === "ETIMEDOUT" || /TIMEOUT/.test(String(code))) {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "spawn_failed" };
  }
  if (!BASH_BANNER_PATTERNS.some((re) => re.test(stdout))) {
    return { ok: false, reason: "no_banner" };
  }
  return { ok: true, stdout };
}

/**
 * 标准化路径比较（Windows NTFS 大小写不敏感，POSIX 严格）。
 * 用于「这个路径是否落在我们认识的目录里」。
 */
function isTrustedBashDir(absPath: string): boolean {
  const normalized = process.platform === "win32"
    ? absPath.toLowerCase()
    : absPath;
  if (process.platform === "win32") {
    return (
      normalized.includes("\\program files\\git\\") ||
      normalized.includes("\\program files (x86)\\git\\") ||
      normalized.includes("\\windows\\") || // system32 系统命令壳
      normalized.includes("\\usr\\bin\\")    // WSL/MSYS bash
    );
  }
  return (
    normalized.startsWith("/bin/") ||
    normalized.startsWith("/usr/bin/") ||
    normalized.startsWith("/usr/local/bin/") ||
    normalized.startsWith("/opt/")
  );
}

/** 读取 strict 模式：不允许 shellPath 落在陌生目录（默认仅推荐）。 */
function warningForUntrustedPath(target: string): string | null {
  if (isTrustedBashDir(target)) return null;
  return `bash 可执行不在常见可信目录（Windows: Git for Windows / System32 / WSL；macOS/Linux: /bin /usr/bin /usr/local/bin /opt），请确认该路径来源可信。`;
}

export async function checkBash(): Promise<BashCheckResult> {
  const settings = await readSettings();
  if (settings.shellPath && (await fileExists(settings.shellPath))) {
    const probe = await probeBash(settings.shellPath);
    if (!probe.ok) {
      return {
        ok: false,
        shellPath: null,
        suggestedShellPath: settings.shellPath,
        message: `已配置的 shellPath 不能作为 bash 执行：${settings.shellPath}（${probeReasonLabel(probe.reason)}）`,
        warning: `请重新选择或点击「检查 bash」；不要让 Pi 用一个非 Bash 的可执行执行命令。`,
      };
    }
    const warning = warningForUntrustedPath(settings.shellPath);
    return {
      ok: true,
      shellPath: settings.shellPath,
      message: `已配置 shellPath: ${settings.shellPath}`,
      suggestedShellPath: settings.shellPath,
      ...(warning ? { warning } : {}),
    };
  }

  const suggested = await findSuggestedBash();
  if (suggested) {
    const warning = warningForUntrustedPath(suggested);
    return {
      ok: true,
      shellPath: suggested,
      message: `已找到 bash: ${suggested}(可写入 Pi settings)`,
      suggestedShellPath: suggested,
      ...(warning ? { warning } : {}),
    };
  }

  return {
    ok: false,
    shellPath: null,
    suggestedShellPath: null,
    message:
      "未检测到 bash。Pi 的 bash 工具需要 Git Bash。请安装 Git for Windows,或点击「写入 shellPath」手动指定。",
  };
}

function probeReasonLabel(reason: ProbeFailureReason): string {
  switch (reason) {
    case "spawn_failed":
      return "启动失败";
    case "no_banner":
      return "输出不是 GNU bash 的 banner";
    case "timeout":
      return "--version 超过 2 秒未返回";
  }
  return "unknown";
}

/** Persist shellPath into ~/.pi/agent/settings.json (with self-check first). */
export async function applyBashShellPath(
  shellPath?: string,
): Promise<BashCheckResult> {
  const target = shellPath || (await findSuggestedBash());
  if (!target || !(await fileExists(target))) {
    return {
      ok: false,
      shellPath: null,
      suggestedShellPath: null,
      message: "没有可用的 bash 路径可写入",
    };
  }
  const probe = await probeBash(target);
  if (!probe.ok) {
    return {
      ok: false,
      shellPath: null,
      suggestedShellPath: target,
      message: `该路径不是 bash 可执行：${target}（${probeReasonLabel(probe.reason)}）`,
    };
  }

  // E6: 与 package-manager 共用 settings.json 的同步原子写，字段互不覆盖。
  mutatePiSettingsSync((settings) => {
    settings.shellPath = target;
  });
  const warning = warningForUntrustedPath(target);
  return {
    ok: true,
    shellPath: target,
    suggestedShellPath: target,
    message: `已写入 shellPath: ${target}`,
    ...(warning ? { warning } : {}),
  };
}