/** Discover Bash, configure it before sessions start, and keep ordinary readiness checks read-only. */
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BashCheckResult } from "../../shared/ipc";
import { mutatePiSettingsSync, piSettingsPath } from "./pi-settings";
import { readJsonStrict, requireJsonObject } from "./lib/atomic-write";

const execFileAsync = promisify(execFile);

/** Resolve the shared Pi settings file for this application profile. */
function settingsPath(): string {
  return piSettingsPath();
}

/** Ignore missing or inaccessible discovery candidates. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Read shell configuration without mutating the shared Pi settings. */
async function readSettings(): Promise<Record<string, unknown>> {
  return requireJsonObject(await readJsonStrict<unknown>(settingsPath(), {}));
}

/** Keep quoted Windows PATH entries usable and avoid searching the current directory for empty entries. */
function pathDirectories(): string[] {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path");
  return (pathKey ? process.env[pathKey] ?? "" : "")
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

/** Read Git's installation registration only after faster directory discovery fails. */
async function registeredGitRoots(): Promise<string[]> {
  const registry = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
  const keys = ["HKCU\\SOFTWARE\\GitForWindows", "HKLM\\SOFTWARE\\GitForWindows", "HKLM\\SOFTWARE\\WOW6432Node\\GitForWindows"];
  const results = await Promise.allSettled(keys.map((key) => execFileAsync(
    registry, ["query", key, "/v", "InstallPath"], { timeout: 1500, windowsHide: true },
  )));
  return results.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    const root = /^\s*InstallPath\s+REG_SZ\s+(.+?)\s*$/im.exec(result.value.stdout)?.[1];
    return root ? [root] : [];
  });
}

/** Find working Bash installations, including portable Git whose cmd directory alone is on PATH. */
export async function findSuggestedBash(): Promise<string | null> {
  const directories = pathDirectories();
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const programRoots = [
      process.env.ProgramFiles ?? "C:\\Program Files",
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "Programs")] : []),
    ];
    for (const root of programRoots) candidates.push(join(root, "Git", "bin", "bash.exe"));
    // Git installers normally add cmd/ rather than bin/ to PATH, regardless of the installation drive.
    for (const directory of directories) {
      if (!(await fileExists(join(directory, "git.exe")))) continue;
      let gitRoot = dirname(directory);
      if (/^mingw(?:32|64)$/i.test(basename(gitRoot))) gitRoot = dirname(gitRoot);
      candidates.push(join(gitRoot, "bin", "bash.exe"), join(gitRoot, "usr", "bin", "bash.exe"));
    }
  }
  candidates.push(...directories.map((directory) => join(directory, process.platform === "win32" ? "bash.exe" : "bash")));
  for (const candidate of new Set(candidates)) {
    if ((await fileExists(candidate)) && (await probeBash(candidate)).ok) return candidate;
  }
  if (process.platform === "win32") {
    for (const root of await registeredGitRoots()) {
      for (const candidate of [join(root, "bin", "bash.exe"), join(root, "usr", "bin", "bash.exe")]) {
        if ((await fileExists(candidate)) && (await probeBash(candidate)).ok) return candidate;
      }
    }
  }
  return null;
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

/** Require a successful GNU Bash banner even for known installation directories. */
async function probeBash(target: string): Promise<ProbeResult> {
  let stdout = "";
  try {
    // timeout 留到 5s:Windows 11 自带的 C:\Windows\system32\bash.exe 是 WSL
    // 转发器,cold start 一次需要 ~2.2s (WSL infrastructure 初始化),2s 不够。
    // Git for Windows does not need WSL infrastructure initialization.
    const result = await execFileAsync(target, ["--version"], { timeout: 5000, windowsHide: true });
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

/** Validate the configured shell first; offer a verified replacement while keeping detection read-only. */
export async function checkBash(): Promise<BashCheckResult> {
  try {
    return await inspectBashSettings(await readSettings());
  } catch (error) {
    return {
      ok: false,
      shellPath: null,
      suggestedShellPath: null,
      message: `无法读取 Bash 配置：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Share validation between startup configuration and read-only checks without writing implicitly. */
async function inspectBashSettings(settings: Record<string, unknown>): Promise<BashCheckResult> {
  if (typeof settings.shellPath === "string" && settings.shellPath) {
    const exists = await fileExists(settings.shellPath);
    const probe = exists ? await probeBash(settings.shellPath) : null;
    if (probe?.ok) {
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
    const warning = suggested ? warningForUntrustedPath(suggested) : null;
    return {
      ok: false,
      shellPath: null,
      suggestedShellPath: suggested,
      message: `已配置的 shellPath 不能作为 bash 执行：${settings.shellPath}（${probe ? probeReasonLabel(probe.reason) : "文件不存在或不可访问"}）。${suggested ? `已找到可用的 Bash，请写入建议路径：${suggested}` : "未找到其他可用的 bash，请在设置中重新选择。"}`,
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

/** Configure a verified fallback once at startup, preserving valid user choices and unrelated Pi settings. */
export async function ensureBashConfigured(): Promise<BashCheckResult> {
  const settings = await readSettings();
  const status = await inspectBashSettings(settings);
  if (status.ok && typeof settings.shellPath === "string" && settings.shellPath) return status;
  if (!status.suggestedShellPath) return status;
  return applyBashShellPath(status.suggestedShellPath);
}

/** Translate probe failures using the actual timeout duration. */
function probeReasonLabel(reason: ProbeFailureReason): string {
  switch (reason) {
    case "spawn_failed":
      return "启动失败";
    case "no_banner":
      return "输出不是 GNU bash 的 banner";
    case "timeout":
      return "--version 超过 5 秒未返回";
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
