/**
 * Build handoff text for Fleet Wave2: prefer git diff, else session excerpt.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HANDOFF_MAX_CHARS = 8 * 1024;

export type GitRunner = (
  cwd: string,
  args: string[],
) => Promise<{ ok: boolean; stdout: string }>;

async function defaultRunGit(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      timeout: 15_000,
    });
    return { ok: true, stdout: String(stdout ?? "") };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export function truncateHandoff(
  text: string,
  maxChars = HANDOFF_MAX_CHARS,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n…(已截断至 ${maxChars} 字符)`;
}

function pushIf(
  parts: string[],
  ok: boolean,
  stdout: string,
  heading: string,
): void {
  if (ok && stdout.trim()) {
    parts.push(`${heading}\n${stdout.trim()}`);
  }
}

/**
 * Prefer unstaged + staged git diffs under cwd; if both empty, include
 * `git status --short`; finally fall back to excerptFn.
 */
export async function buildPairHandoff(
  cwd: string,
  excerptFn: () => string,
  runGit: GitRunner = defaultRunGit,
): Promise<string> {
  const [stat, diff, cachedStat, cachedDiff] = await Promise.all([
    runGit(cwd, ["diff", "--stat"]),
    runGit(cwd, ["diff"]),
    runGit(cwd, ["diff", "--cached", "--stat"]),
    runGit(cwd, ["diff", "--cached"]),
  ]);

  const parts: string[] = [];
  pushIf(parts, stat.ok, stat.stdout, "### git diff --stat");
  pushIf(parts, diff.ok, diff.stdout, "### git diff");
  pushIf(parts, cachedStat.ok, cachedStat.stdout, "### git diff --cached --stat");
  pushIf(parts, cachedDiff.ok, cachedDiff.stdout, "### git diff --cached");

  if (parts.length > 0) {
    return truncateHandoff(parts.join("\n\n"));
  }

  const status = await runGit(cwd, ["status", "--short"]);
  if (status.ok && status.stdout.trim()) {
    return truncateHandoff(
      "### git status --short（无可用 diff）\n" + status.stdout.trim(),
    );
  }

  const excerpt = excerptFn().trim();
  if (excerpt) {
    return truncateHandoff("### 会话摘录（无可用 git diff）\n" + excerpt);
  }

  return "（工作区无 git 变更，且实现槽无可用会话摘录）";
}
