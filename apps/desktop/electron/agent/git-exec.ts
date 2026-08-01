/**
 * Thin git CLI helpers shared by shadow checkpoints and other main-process tools.
 * Reuses the same Windows git.exe discovery pattern used elsewhere in the agent.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import type { GitCheckResult } from "../../shared/ipc";

let cachedGitExecutable: string | null = null;
let cachedAvailable: boolean | null = null;

export function resolveGitExecutable(): string {
  if (cachedGitExecutable) return cachedGitExecutable;
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Git\\cmd\\git.exe",
          "C:\\Program Files\\Git\\bin\\git.exe",
          "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
          "C:\\Program Files (x86)\\Git\\bin\\git.exe",
        ]
      : [];
  for (const c of candidates) {
    if (existsSync(c)) {
      cachedGitExecutable = c;
      return c;
    }
  }
  cachedGitExecutable = "git";
  return cachedGitExecutable;
}

export type GitExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export function runGit(
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  },
): Promise<GitExecResult> {
  const git = resolveGitExecutable();
  const timeoutMs = options?.timeoutMs ?? 120_000;
  return new Promise((resolvePromise) => {
    const child = spawn(git, args, {
      cwd: options?.cwd,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        ...options?.env,
      },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolvePromise({
        code: 124,
        stdout,
        stderr: stderr || `git timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        code: 127,
        stdout,
        stderr: err.message,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Probe whether git is runnable (cached). */
export async function isGitAvailable(): Promise<boolean> {
  if (cachedAvailable != null) return cachedAvailable;
  const result = await runGit(["--version"], { timeoutMs: 8_000 });
  cachedAvailable = result.code === 0;
  return cachedAvailable;
}

/** Clear path / availability cache so a later probe can see a newly installed git. */
export function invalidateGitExecCache(): void {
  cachedGitExecutable = null;
  cachedAvailable = null;
}

/**
 * User-facing git probe for the ready checklist / settings.
 * Always invalidates cache first so 「检测」 works after installing Git.
 */
export async function checkGit(): Promise<GitCheckResult> {
  invalidateGitExecCache();
  const ok = await isGitAvailable();
  if (ok) {
    const gitPath = resolveGitExecutable();
    return {
      ok: true,
      gitPath,
      message: `已检测到 Git: ${gitPath}`,
    };
  }
  return {
    ok: false,
    gitPath: null,
    message:
      "未检测到 git。Shadow Git 工作区检查点需要 Git。请安装 Git for Windows，安装后点击「检测」。",
  };
}

/** @internal */
export function resetGitExecCacheForTests(): void {
  invalidateGitExecCache();
}
