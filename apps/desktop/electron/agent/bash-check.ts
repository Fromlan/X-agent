import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BashCheckResult } from "../../shared/ipc";

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
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function findSuggestedBash(): Promise<string | null> {
  for (const candidate of CANDIDATES) {
    if (await fileExists(candidate)) return candidate;
  }
  return whichBashOnPath();
}

/**
 * 验证路径是否实际可执行 bash(对 spawn(target, ["--version"]) 做一次短时自检,
 * 防止被攻陷的 renderer 写入任意可执行路径后被 Pi bash 工具执行)。
 */
async function probeBash(target: string): Promise<boolean> {
  try {
    await execFileAsync(target, ["--version"], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export async function checkBash(): Promise<BashCheckResult> {
  const settings = await readSettings();
  if (settings.shellPath && (await fileExists(settings.shellPath))) {
    return {
      ok: true,
      shellPath: settings.shellPath,
      message: `已配置 shellPath: ${settings.shellPath}`,
      suggestedShellPath: settings.shellPath,
    };
  }

  const suggested = await findSuggestedBash();
  if (suggested) {
    return {
      ok: true,
      shellPath: suggested,
      message: `已找到 bash: ${suggested}(可写入 Pi settings)`,
      suggestedShellPath: suggested,
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
  if (!(await probeBash(target))) {
    return {
      ok: false,
      shellPath: null,
      suggestedShellPath: target,
      message: `该路径不是 bash 可执行:${target}(--version 自检失败)`,
    };
  }

  const path = settingsPath();
  await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
  let settings: Record<string, unknown> = {};
  try {
    const raw = await readFile(path, "utf8");
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    settings = {};
  }
  settings.shellPath = target;
  await writeFile(path, JSON.stringify(settings, null, 2), "utf8");
  return {
    ok: true,
    shellPath: target,
    suggestedShellPath: target,
    message: `已写入 shellPath: ${target}`,
  };
}