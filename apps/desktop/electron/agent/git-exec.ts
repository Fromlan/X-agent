/**
 * Thin git CLI helpers shared by shadow checkpoints and other main-process tools.
 * Reuses the same Windows git.exe discovery pattern as godot-docs-cache.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

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

/** @internal */
export function resetGitExecCacheForTests(): void {
  cachedGitExecutable = null;
  cachedAvailable = null;
}
