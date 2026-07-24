import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { PiCliStatus } from "../../shared/ipc";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const ERROR_TAIL = 800;

function pathParts(pathEnv: string, platform: NodeJS.Platform): string[] {
  return pathEnv
    .split(platform === "win32" ? ";" : ":")
    .map((p) => p.trim())
    .filter(Boolean);
}

function candidateNames(base: string, platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    return [`${base}.cmd`, `${base}.exe`, base];
  }
  return [base];
}

/** Resolve an executable by scanning PATH-like env (exported for tests). */
export function resolveBinaryFromPathEnv(
  base: string,
  pathEnv: string,
  platform: NodeJS.Platform = process.platform,
  fileExists: (p: string) => boolean = existsSync,
): string | null {
  for (const part of pathParts(pathEnv, platform)) {
    for (const name of candidateNames(base, platform)) {
      const candidate = join(part, name);
      if (fileExists(candidate)) return candidate;
    }
  }
  return null;
}

export function resolvePiFromPathEnv(
  pathEnv: string,
  platform: NodeJS.Platform = process.platform,
  fileExists: (p: string) => boolean = existsSync,
): string | null {
  return resolveBinaryFromPathEnv("pi", pathEnv, platform, fileExists);
}

export function resolveNpmFromPathEnv(
  pathEnv: string,
  platform: NodeJS.Platform = process.platform,
  fileExists: (p: string) => boolean = existsSync,
): string | null {
  return resolveBinaryFromPathEnv("npm", pathEnv, platform, fileExists);
}

function truncateTail(text: string, max = ERROR_TAIL): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `…${trimmed.slice(-max)}`;
}

export function checkPiCli(
  pathEnv: string = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
  fileExists: (p: string) => boolean = existsSync,
): PiCliStatus {
  const piPath = resolvePiFromPathEnv(pathEnv, platform, fileExists);
  const npmPath = resolveNpmFromPathEnv(pathEnv, platform, fileExists);
  const canInstall = Boolean(npmPath);

  if (piPath) {
    return {
      ok: true,
      piPath,
      message: `已检测到 Pi CLI: ${piPath}`,
      canInstall,
    };
  }

  return {
    ok: false,
    piPath: null,
    message: canInstall
      ? "未检测到全局 Pi CLI。可选安装以便使用 `pi` /login、`pi install` 等命令。"
      : "未检测到全局 Pi CLI，且未找到 npm。请先安装 Node.js 22+ 后再安装 Pi CLI。",
    canInstall,
  };
}

function runNpmInstall(npmPath: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const args = ["install", "-g", "--ignore-scripts", PI_PACKAGE];
    const child = spawn(npmPath, args, {
      windowsHide: true,
      env: process.env,
    });

    let output = "";
    const append = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > 50_000) {
        output = output.slice(-40_000);
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const timer = setTimeout(() => {
      child.kill();
      resolve({
        code: null,
        output: `${output}\n安装超时（>${INSTALL_TIMEOUT_MS / 1000}s）`,
      });
    }, INSTALL_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, output: `${output}\n${err.message}` });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

const SETTINGS_PROVIDER_HINT =
  "也可在设置 → 供应商中配置 API Key（无需 Pi CLI 登录）。";

/**
 * Open an interactive terminal running `pi` so the user can `/login`.
 * Falls back to a manual hint when spawn fails or Pi CLI is missing.
 */
export async function openPiLogin(): Promise<{
  ok: boolean;
  error?: string;
  hint?: string;
}> {
  const status = checkPiCli();
  const hint = SETTINGS_PROVIDER_HINT;

  if (!status.ok || !status.piPath) {
    return {
      ok: false,
      error: status.message,
      hint: `请先安装 Pi CLI，然后在终端运行 pi 并输入 /login。${hint}`,
    };
  }

  try {
    if (process.platform === "win32") {
      // Open a visible cmd window that stays open with `pi` on PATH.
      const child = spawn(
        "cmd",
        ["/c", "start", "cmd", "/k", "pi"],
        {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
          env: process.env,
        },
      );
      child.unref();
    } else if (process.platform === "darwin") {
      const child = spawn(
        "osascript",
        [
          "-e",
          'tell application "Terminal" to do script "pi"',
          "-e",
          'tell application "Terminal" to activate',
        ],
        { detached: true, stdio: "ignore", env: process.env },
      );
      child.unref();
    } else {
      const term =
        resolveBinaryFromPathEnv("x-terminal-emulator", process.env.PATH ?? "") ??
        resolveBinaryFromPathEnv("gnome-terminal", process.env.PATH ?? "") ??
        resolveBinaryFromPathEnv("xterm", process.env.PATH ?? "");
      if (!term) {
        return {
          ok: false,
          error: "未找到可用终端模拟器",
          hint: `请手动在终端运行 pi，进入后输入 /login。${hint}`,
        };
      }
      const child = spawn(term, ["-e", "pi"], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.unref();
    }

    return {
      ok: true,
      hint: `已打开终端。在 Pi 中输入 /login 完成认证。${hint}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `无法打开终端：${message}`,
      hint: `请手动运行 pi，进入后输入 /login。${hint}`,
    };
  }
}

/** Install global Pi CLI via npm; re-check PATH afterward. */
export async function installPiCli(): Promise<PiCliStatus> {
  const pathEnv = process.env.PATH ?? "";
  const npmPath = resolveNpmFromPathEnv(pathEnv);
  if (!npmPath) {
    return {
      ok: false,
      piPath: null,
      message: "未找到 npm，无法安装 Pi CLI。请先安装 Node.js 22+。",
      canInstall: false,
    };
  }

  const { code, output } = await runNpmInstall(npmPath);
  if (code !== 0) {
    const detail = truncateTail(output) || `退出码 ${code ?? "null"}`;
    return {
      ok: false,
      piPath: null,
      message: `Pi CLI 安装失败：${detail}`,
      canInstall: true,
    };
  }

  const status = checkPiCli();
  if (status.ok) {
    return {
      ...status,
      message: `Pi CLI 安装成功：${status.piPath}`,
    };
  }

  return {
    ok: false,
    piPath: null,
    message:
      "npm 安装已完成，但 PATH 中仍未找到 `pi`。请重新打开应用，或确认 npm 全局 bin 目录已加入 PATH。",
    canInstall: true,
  };
}
