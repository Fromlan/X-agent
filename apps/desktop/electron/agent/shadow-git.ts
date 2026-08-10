/**
 * Shadow Git: independent GIT_DIR mirroring a project work tree for checkpoints.
 * Never writes to the user's real .git / HEAD / index / stash.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { isGitAvailable, runGit, type GitExecResult } from "./git-exec";
import { ensureAgentDir } from "./prefs";
import { resolveInsideCwd } from "./cwd-sandbox";
import { truncateDiffText } from "./baseline-diff";

/** Marker rename suffix while shadow-git add runs (avoid nested-repo gitlinks). */
export const NESTED_GIT_DISABLED_SUFFIX = ".__xagent_shadow__";

export const DEFAULT_SHADOW_EXCLUDES = [
  ".git/",
  `.git${NESTED_GIT_DISABLED_SUFFIX}/`,
  ".svn/",
  ".hg/",
  "node_modules/",
  ".godot/",
  "dist/",
  "build/",
  "out/",
  "release/",
  ".next/",
  ".nuxt/",
  ".turbo/",
  "coverage/",
  "__pycache__/",
  "*.pyc",
  ".DS_Store",
  "Thumbs.db",
  "*.exe",
  "*.dll",
  "*.so",
  "*.dylib",
  "*.wasm",
  ".x-agent/",
];

export type ShadowCommitResult =
  | { ok: true; sha: string; skipped?: boolean }
  | { ok: false; error: string };

export type ShadowRestoreResult = {
  ok: boolean;
  restored: string[];
  deleted: string[];
  skipped: Array<{ path?: string; reason: string; detail?: string }>;
  warnings: string[];
  error?: string;
};

export type ShadowDiffResult = {
  ok: boolean;
  paths: string[];
  error?: string;
};

export type ShadowDiffTextResult = {
  ok: boolean;
  /** Unified diff text (path headers + hunks), already truncated to the cap. */
  text?: string;
  /** True when the output was cut to fit the size cap. */
  truncated?: boolean;
  error?: string;
};

/** Cap for diff payloads crossing IPC (per call); oversized diffs are head-truncated. */
export const SHADOW_DIFF_TEXT_MAX_BYTES = 256 * 1024;

/** Checkpoints root under ~/.pi/agent/x-agent/checkpoints (respects prefs agentDir override). */
export function getCheckpointsRoot(): string {
  return join(ensureAgentDir(), "x-agent", "checkpoints");
}

export function projectKeyForCwd(cwd: string): string {
  const norm = resolve(cwd).replace(/\\/g, "/").toLowerCase();
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export function shadowGitDirForCwd(cwd: string): string {
  return join(getCheckpointsRoot(), projectKeyForCwd(cwd));
}

function shadowEnv(gitDir: string, workTree: string): NodeJS.ProcessEnv {
  return {
    GIT_DIR: gitDir,
    GIT_WORK_TREE: workTree,
    GIT_AUTHOR_NAME: "X-agent",
    GIT_AUTHOR_EMAIL: "x-agent@local",
    GIT_COMMITTER_NAME: "X-agent",
    GIT_COMMITTER_EMAIL: "x-agent@local",
  };
}

async function gitShadow(
  gitDir: string,
  workTree: string,
  args: string[],
  timeoutMs?: number,
): Promise<GitExecResult> {
  return runGit(args, {
    cwd: workTree,
    env: shadowEnv(gitDir, workTree),
    timeoutMs,
  });
}

function splitPaths(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

/** Walk cwd for `.git` dirs/files (nested repos) to temporarily disable. */
export function findNestedGitEntries(cwd: string): string[] {
  const found: string[] = [];
  const root = resolve(cwd);
  const walk = (dir: string, depth: number) => {
    if (depth > 12) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (
        name === "node_modules" ||
        name === ".godot" ||
        name === "dist" ||
        name === "build" ||
        name === "out"
      ) {
        continue;
      }
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (name === ".git") {
        found.push(abs);
        continue;
      }
      if (st.isDirectory()) walk(abs, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/**
 * If a previous crash left `.git.__xagent_shadow__`, rename back before new work.
 * Returns how many nested repos were recovered.
 */
export function recoverDisabledNestedGit(cwd: string): number {
  const root = resolve(cwd);
  let recovered = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 12) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (
        name === "node_modules" ||
        name === ".godot" ||
        name === "dist" ||
        name === "build" ||
        name === "out"
      ) {
        continue;
      }
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (name === `.git${NESTED_GIT_DISABLED_SUFFIX}`) {
        const restored = join(dir, ".git");
        if (!existsSync(restored)) {
          try {
            renameSync(abs, restored);
            recovered += 1;
          } catch {
            /* leave for next attempt */
          }
        }
        continue;
      }
      if (st.isDirectory()) walk(abs, depth + 1);
    }
  };
  walk(root, 0);
  return recovered;
}

/** Path of the file recording which work tree a shadow repo mirrors. */
function worktreePathFile(gitDir: string): string {
  return join(gitDir, "worktree-path");
}

/**
 * 启动兜底：扫描所有 shadow 检查点仓库记录的 work tree，
 * 把崩溃残留的 `.git.__xagent_shadow__` 改名恢复（避免用户项目不可用）。
 * 返回恢复的嵌套仓库数量。
 */
export function recoverAllDisabledNestedGit(): number {
  const root = getCheckpointsRoot();
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of dirs) {
    const gitDir = join(root, name);
    let st;
    try {
      st = statSync(gitDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    let cwd: string;
    try {
      cwd = readFileSync(worktreePathFile(gitDir), "utf8").trim();
    } catch {
      continue;
    }
    if (!cwd) continue;
    total += recoverDisabledNestedGit(cwd);
  }
  return total;
}

async function withNestedGitDisabled<T>(
  cwd: string,
  fn: () => Promise<T>,
): Promise<T> {
  recoverDisabledNestedGit(cwd);
  const nested = findNestedGitEntries(cwd);
  const renamed: Array<{ from: string; to: string }> = [];
  try {
    for (const from of nested) {
      const to = `${from}${NESTED_GIT_DISABLED_SUFFIX}`;
      if (existsSync(to)) continue;
      try {
        renameSync(from, to);
        renamed.push({ from, to });
      } catch {
        // leave as-is; add may create a gitlink for this nested repo
      }
    }
    return await fn();
  } finally {
    for (const { from, to } of renamed.reverse()) {
      try {
        if (existsSync(to) && !existsSync(from)) renameSync(to, from);
      } catch {
        /* best-effort restore */
      }
    }
  }
}

function buildExcludeContents(cwd: string): string {
  const lines = [
    "# X-agent shadow git excludes",
    ...DEFAULT_SHADOW_EXCLUDES,
  ];
  const gi = join(cwd, ".gitignore");
  if (existsSync(gi)) {
    try {
      const raw = readFileSync(gi, "utf8");
      lines.push("# --- project .gitignore ---", raw);
    } catch {
      /* ignore */
    }
  }
  return `${lines.join("\n")}\n`;
}

export class ShadowGit {
  readonly cwd: string;
  readonly gitDir: string;
  private ready = false;
  private unavailableReason: string | null = null;

  constructor(cwd: string, gitDir?: string) {
    this.cwd = resolve(cwd);
    this.gitDir = gitDir ? resolve(gitDir) : shadowGitDirForCwd(this.cwd);
  }

  isReady(): boolean {
    return this.ready;
  }

  getUnavailableReason(): string | null {
    return this.unavailableReason;
  }

  async ensureRepo(): Promise<{ ok: boolean; error?: string }> {
    if (!(await isGitAvailable())) {
      this.unavailableReason = "未检测到 Git，工作区 Shadow 检查点不可用";
      this.ready = false;
      return { ok: false, error: this.unavailableReason };
    }
    try {
      recoverDisabledNestedGit(this.cwd);
      mkdirSync(this.gitDir, { recursive: true });
      const head = join(this.gitDir, "HEAD");
      if (!existsSync(head)) {
        const init = await gitShadow(this.gitDir, this.cwd, [
          "init",
          "--initial-branch=main",
        ]);
        if (init.code !== 0) {
          const init2 = await gitShadow(this.gitDir, this.cwd, ["init"]);
          if (init2.code !== 0) {
            const err = (init2.stderr || init.stderr || "git init failed").trim();
            this.unavailableReason = err;
            this.ready = false;
            return { ok: false, error: err };
          }
        }
        await gitShadow(this.gitDir, this.cwd, [
          "config",
          "core.autocrlf",
          "false",
        ]);
        await gitShadow(this.gitDir, this.cwd, [
          "config",
          "commit.gpgsign",
          "false",
        ]);
      }
      const infoDir = join(this.gitDir, "info");
      mkdirSync(infoDir, { recursive: true });
      writeFileSync(
        join(infoDir, "exclude"),
        buildExcludeContents(this.cwd),
        "utf8",
      );
      // 记录 work tree，供应用启动时恢复崩溃残留的改名嵌套 .git。
      try {
        writeFileSync(worktreePathFile(this.gitDir), this.cwd, "utf8");
      } catch {
        /* non-fatal */
      }
      this.ready = true;
      this.unavailableReason = null;
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.unavailableReason = message;
      this.ready = false;
      return { ok: false, error: message };
    }
  }

  /**
   * Stage all work-tree files (honoring excludes) and commit.
   * Skips creating a new commit when the tree is unchanged (returns prior HEAD).
   */
  async commit(message: string): Promise<ShadowCommitResult> {
    const ensured = await this.ensureRepo();
    if (!ensured.ok) {
      return { ok: false, error: ensured.error ?? "shadow git unavailable" };
    }

    return withNestedGitDisabled(this.cwd, async () => {
      const add = await gitShadow(this.gitDir, this.cwd, ["add", "-A"], 180_000);
      if (add.code !== 0) {
        return {
          ok: false,
          error: (add.stderr || add.stdout || "git add failed")
            .trim()
            .slice(0, 500),
        };
      }

      const status = await gitShadow(this.gitDir, this.cwd, [
        "status",
        "--porcelain",
      ]);
      if (status.code === 0 && !status.stdout.trim()) {
        const head = await this.revParse("HEAD");
        if (head) return { ok: true, sha: head, skipped: true };
      }

      const commit = await gitShadow(this.gitDir, this.cwd, [
        "commit",
        "--allow-empty",
        "-m",
        message,
        "--no-verify",
        "--no-gpg-sign",
      ]);
      if (commit.code !== 0) {
        return {
          ok: false,
          error: (commit.stderr || commit.stdout || "git commit failed")
            .trim()
            .slice(0, 500),
        };
      }
      const sha = await this.revParse("HEAD");
      if (!sha) return { ok: false, error: "commit succeeded but HEAD missing" };

      // B9: 修剪检查点仓库 —— 撤回/abort 产生的孤儿 commit 立即变为不可达
      // 并回收，避免 ~/.pi/agent/x-agent/checkpoints 无界膨胀。
      // 当前分支可达链不受影响（reflog expire 只清不可达条目）。
      await gitShadow(this.gitDir, this.cwd, [
        "reflog",
        "expire",
        "--expire-unreachable=now",
        "--all",
      ]);
      await gitShadow(this.gitDir, this.cwd, ["gc", "--auto", "--prune=now"]);

      return { ok: true, sha };
    });
  }

  async revParse(ref: string): Promise<string | null> {
    const r = await gitShadow(this.gitDir, this.cwd, ["rev-parse", ref]);
    if (r.code !== 0) return null;
    const sha = r.stdout.trim();
    return sha || null;
  }

  /**
   * Paths that differ between two commits, or between a commit and the work tree
   * when `toSha` is omitted (`git diff --name-only <fromSha>`).
   */
  async diffPaths(fromSha: string, toSha?: string): Promise<ShadowDiffResult> {
    const ensured = await this.ensureRepo();
    if (!ensured.ok) {
      return { ok: false, paths: [], error: ensured.error };
    }
    const args = toSha
      ? ["diff", "--name-only", fromSha, toSha]
      : ["diff", "--name-only", fromSha];
    const r = await gitShadow(this.gitDir, this.cwd, args);
    if (r.code !== 0) {
      return {
        ok: false,
        paths: [],
        error: (r.stderr || r.stdout || "git diff failed").trim().slice(0, 400),
      };
    }
    return { ok: true, paths: splitPaths(r.stdout) };
  }

  /**
   * Union of commit-to-commit and commit-to-worktree path diffs.
   * Preview needs both so dirty files after the last post still show up.
   */
  async diffPathsIncludingWorktree(
    fromSha: string,
    headSha: string | null,
  ): Promise<ShadowDiffResult> {
    const paths = new Set<string>();
    if (headSha) {
      const a = await this.diffPaths(fromSha, headSha);
      if (!a.ok) return a;
      for (const p of a.paths) paths.add(p);
    }
    const b = await this.diffPaths(fromSha);
    if (!b.ok) {
      if (paths.size === 0) return b;
      // Prefer commit diff if worktree diff failed
      return { ok: true, paths: [...paths] };
    }
    for (const p of b.paths) paths.add(p);
    return { ok: true, paths: [...paths] };
  }

  /**
   * Unified diff text between two commits, or between a commit and the work
   * tree when `toSha` is omitted (`git diff -U3 <fromSha> [<toSha>]`).
   * Output is head-truncated at SHADOW_DIFF_TEXT_MAX_BYTES (line-aligned) so
   * oversized diffs cannot blow up IPC or the renderer.
   */
  async diffText(
    fromSha: string,
    toSha?: string,
    options?: { maxBytes?: number },
  ): Promise<ShadowDiffTextResult> {
    const ensured = await this.ensureRepo();
    if (!ensured.ok) {
      return { ok: false, error: ensured.error };
    }
    const args = [
      "diff",
      "--no-ext-diff",
      "--no-color",
      "-U3",
      fromSha,
      ...(toSha ? [toSha] : []),
    ];
    const r = await gitShadow(this.gitDir, this.cwd, args, 60_000);
    if (r.code !== 0) {
      return {
        ok: false,
        error: (r.stderr || r.stdout || "git diff failed").trim().slice(0, 400),
      };
    }
    const maxBytes = options?.maxBytes ?? SHADOW_DIFF_TEXT_MAX_BYTES;
    const raw = r.stdout;
    const { text, truncated } = truncateDiffText(raw, maxBytes);
    return truncated ? { ok: true, text, truncated: true } : { ok: true, text };
  }

  /**
   * Restore work tree to `sha` without touching the user's real git.
   * Optional path filter: only checkout those paths from sha.
   */
  async restore(
    sha: string,
    options?: { paths?: string[] },
  ): Promise<ShadowRestoreResult> {
    const restored: string[] = [];
    const deleted: string[] = [];
    const skipped: ShadowRestoreResult["skipped"] = [];
    const warnings: string[] = [];

    const ensured = await this.ensureRepo();
    if (!ensured.ok) {
      return {
        ok: false,
        restored,
        deleted,
        skipped,
        warnings,
        error: ensured.error,
      };
    }

    const target = await this.revParse(sha);
    if (!target) {
      return {
        ok: false,
        restored,
        deleted,
        skipped: [{ reason: "error", detail: `unknown sha ${sha}` }],
        warnings,
        error: `检查点不存在: ${sha.slice(0, 8)}`,
      };
    }

    const paths = options?.paths?.map((p) => p.replace(/\\/g, "/"));

    try {
      if (paths && paths.length > 0) {
        const ls = await gitShadow(this.gitDir, this.cwd, [
          "ls-tree",
          "-r",
          "--name-only",
          target,
        ]);
        const inTree = new Set(splitPaths(ls.stdout));
        for (const rel of paths) {
          const resolved = resolveInsideCwd(this.cwd, rel);
          if (!resolved.ok) {
            skipped.push({
              path: rel,
              reason: "outside_cwd",
              detail: resolved.error,
            });
            continue;
          }
          if (!inTree.has(resolved.rel)) {
            if (existsSync(resolved.abs)) {
              try {
                rmSync(resolved.abs, { force: true });
                deleted.push(resolved.rel);
              } catch (err) {
                skipped.push({
                  path: resolved.rel,
                  reason: "error",
                  detail: err instanceof Error ? err.message : String(err),
                });
              }
            }
            continue;
          }
          const co = await gitShadow(this.gitDir, this.cwd, [
            "checkout",
            target,
            "--",
            resolved.rel,
          ]);
          if (co.code !== 0) {
            skipped.push({
              path: resolved.rel,
              reason: "error",
              detail: (co.stderr || co.stdout).trim().slice(0, 200),
            });
          } else {
            restored.push(resolved.rel);
          }
        }
      } else {
        // Capture classification BEFORE reset --hard moves HEAD.
        const headSha = await this.revParse("HEAD");
        let changed: string[] = [];
        let addedSince = new Set<string>();
        if (headSha && headSha !== target) {
          const before = await this.diffPaths(target, headSha);
          changed = before.ok ? before.paths : [];
          const onlyOld = await gitShadow(this.gitDir, this.cwd, [
            "diff",
            "--name-only",
            "--diff-filter=A",
            target,
            headSha,
          ]);
          addedSince = new Set(splitPaths(onlyOld.stdout));
        }

        const reset = await gitShadow(this.gitDir, this.cwd, [
          "reset",
          "--hard",
          target,
        ]);
        if (reset.code !== 0) {
          return {
            ok: false,
            restored,
            deleted,
            skipped: [
              {
                reason: "error",
                detail: (reset.stderr || reset.stdout).trim().slice(0, 400),
              },
            ],
            warnings,
            error: "Shadow 工作区还原失败",
          };
        }

        for (const p of changed) {
          if (addedSince.has(p)) deleted.push(p);
          else restored.push(p);
        }
      }

      return { ok: true, restored, deleted, skipped, warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        restored,
        deleted,
        skipped: [{ reason: "error", detail: message }],
        warnings,
        error: message,
      };
    }
  }

  /** Remove shadow repo directory (tests / cleanup). */
  destroy(): void {
    try {
      rmSync(this.gitDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    this.ready = false;
  }
}

/** @internal */
export function relFromCwd(cwd: string, abs: string): string {
  return relative(cwd, abs).replace(/\\/g, "/");
}
