import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { BashCheckResult } from "../../shared/ipc";

const CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

function settingsPath(): string {
  return join(homedir(), ".pi", "agent", "settings.json");
}

function whichBashOnPath(): string | null {
  const pathEnv = process.env.PATH ?? "";
  const parts = pathEnv.split(process.platform === "win32" ? ";" : ":");
  for (const part of parts) {
    const candidate = join(part.trim(), process.platform === "win32" ? "bash.exe" : "bash");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findSuggestedBash(): string | null {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return whichBashOnPath();
}

export function checkBash(): BashCheckResult {
  try {
    const path = settingsPath();
    if (existsSync(path)) {
      const settings = JSON.parse(readFileSync(path, "utf8")) as {
        shellPath?: string;
      };
      if (settings.shellPath && existsSync(settings.shellPath)) {
        return {
          ok: true,
          shellPath: settings.shellPath,
          message: `已配置 shellPath: ${settings.shellPath}`,
          suggestedShellPath: settings.shellPath,
        };
      }
    }
  } catch {
    // ignore
  }

  const suggested = findSuggestedBash();
  if (suggested) {
    return {
      ok: true,
      shellPath: suggested,
      message: `已找到 bash: ${suggested}（可写入 Pi settings）`,
      suggestedShellPath: suggested,
    };
  }

  return {
    ok: false,
    shellPath: null,
    suggestedShellPath: null,
    message:
      "未检测到 bash。Pi 的 bash 工具需要 Git Bash。请安装 Git for Windows，或点击「写入 shellPath」手动指定。",
  };
}

/** Persist shellPath into ~/.pi/agent/settings.json */
export function applyBashShellPath(shellPath?: string): BashCheckResult {
  const target = shellPath || findSuggestedBash();
  if (!target || !existsSync(target)) {
    return {
      ok: false,
      shellPath: null,
      suggestedShellPath: null,
      message: "没有可用的 bash 路径可写入",
    };
  }

  const path = settingsPath();
  mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }
  settings.shellPath = target;
  writeFileSync(path, JSON.stringify(settings, null, 2), "utf8");
  return {
    ok: true,
    shellPath: target,
    suggestedShellPath: target,
    message: `已写入 shellPath: ${target}`,
  };
}
