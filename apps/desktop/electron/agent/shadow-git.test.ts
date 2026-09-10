/**
 * Vitest unit test for `electron/agent/shadow-git`.
 *
 * Three layers:
 *  1. Pure functions (no fs, no git): getCheckpointsRoot / projectKeyForCwd /
 *     shadowGitDirForCwd / relFromCwd / NESTED_GIT_DISABLED_SUFFIX /
 *     DEFAULT_SHADOW_EXCLUDES / SHADOW_DIFF_TEXT_MAX_BYTES.
 *  2. Filesystem-touching helpers (need a temp dir but no git): findNestedGitEntries,
 *     recoverDisabledNestedGit / recoverAllDisabledNestedGit.
 *  3. Git-dependent operations: ShadowGit class (commit / diff / restore).
 *     Skipped when git is unavailable (e.g. minimal CI runner without Git for
 *     Windows), matching the shadow-checkpoints pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { execSync } from "node:child_process";
import {
  NESTED_GIT_DISABLED_SUFFIX,
  DEFAULT_SHADOW_EXCLUDES,
  SHADOW_DIFF_TEXT_MAX_BYTES,
  getCheckpointsRoot,
  projectKeyForCwd,
  shadowGitDirForCwd,
  relFromCwd,
  findNestedGitEntries,
  recoverDisabledNestedGit,
  recoverAllDisabledNestedGit,
  ShadowGit,
} from "./shadow-git";

function gitAvailable(): boolean {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("shadow-git constants", () => {
  it("NESTED_GIT_DISABLED_SUFFIX marks disabled nested .git dirs", () => {
    expect(NESTED_GIT_DISABLED_SUFFIX).toBe(".__xagent_shadow__");
  });

  it("DEFAULT_SHADOW_EXCLUDES mirrors the shadow-git exclude baseline", () => {
    expect(DEFAULT_SHADOW_EXCLUDES).toContain(".git/");
    expect(DEFAULT_SHADOW_EXCLUDES).toContain(`.git${NESTED_GIT_DISABLED_SUFFIX}/`);
    expect(DEFAULT_SHADOW_EXCLUDES).toContain("node_modules/");
  });

  it("SHADOW_DIFF_TEXT_MAX_BYTES is the published cap", () => {
    expect(SHADOW_DIFF_TEXT_MAX_BYTES).toBe(256 * 1024);
  });
});

describe("shadow-git pure helpers", () => {
  it("projectKeyForCwd hashes the cwd to a stable opaque key", () => {
    const k1 = projectKeyForCwd("/tmp/foo");
    const k2 = projectKeyForCwd("/tmp/foo");
    expect(k1).toBe(k2);
    expect(projectKeyForCwd("/tmp/bar")).not.toBe(k1);
    expect(k1).toMatch(/^[a-f0-9]{16}$/);
  });

  it("shadowGitDirForCwd nests the key under the checkpoints root", () => {
    const dir = shadowGitDirForCwd("/tmp/foo");
    expect(dir).toBe(join(getCheckpointsRoot(), projectKeyForCwd("/tmp/foo")));
  });

  it("getCheckpointsRoot is a non-empty absolute-looking string", () => {
    const root = getCheckpointsRoot();
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
  });

  it("relFromCwd returns cwd-relative path for an absolute child", () => {
    const cwd = "/tmp/proj";
    const abs = "/tmp/proj/src/index.ts";
    const r = relFromCwd(cwd, abs);
    expect(r.startsWith("src")).toBe(true);
  });

  it("relFromCwd returns empty string when path equals cwd", () => {
    expect(relFromCwd("/tmp/proj", "/tmp/proj")).toBe("");
  });
});

describe("shadow-git fs helpers (no git required)", () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "x-agent-shadow-git-"));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it("findNestedGitEntries returns empty for a dir with no .git", () => {
    expect(findNestedGitEntries(work)).toEqual([]);
  });

  it("findNestedGitEntries lists active .git dirs but skips disabled-suffix dirs", () => {
    mkdirSync(join(work, "sub", ".git"), { recursive: true });
    mkdirSync(join(work, "sub2", `.git${NESTED_GIT_DISABLED_SUFFIX}`), {
      recursive: true,
    });
    const found = findNestedGitEntries(work);
    expect(found.length).toBe(1);
    expect(found[0].endsWith(sep + "sub" + sep + ".git")).toBe(true);
  });

  it("recoverDisabledNestedGit restores disabled .git dirs to .git", () => {
    const disabled = join(work, "sub", `.git${NESTED_GIT_DISABLED_SUFFIX}`);
    mkdirSync(disabled, { recursive: true });
    writeFileSync(join(disabled, "HEAD"), "ref: refs/heads/main", "utf8");

    const restored = recoverDisabledNestedGit(work);
    expect(restored).toBe(1);
    expect(existsSync(join(work, "sub", ".git"))).toBe(true);
    expect(existsSync(disabled)).toBe(false);
  });

  it("recoverDisabledNestedGit leaves active .git dirs untouched", () => {
    const active = join(work, "sub", ".git");
    mkdirSync(active, { recursive: true });
    writeFileSync(join(active, "HEAD"), "ref: refs/heads/main", "utf8");

    const restored = recoverDisabledNestedGit(work);
    expect(restored).toBe(0);
    expect(existsSync(active)).toBe(true);
  });

  it("recoverAllDisabledNestedGit walks from cwd upward without throwing", () => {
    const here = mkdtempSync(join(tmpdir(), "x-agent-shadow-git-walk-"));
    const sub = join(here, "sub");
    const disabled = join(sub, `.git${NESTED_GIT_DISABLED_SUFFIX}`);
    mkdirSync(disabled, { recursive: true });
    writeFileSync(join(disabled, "HEAD"), "ref: refs/heads/main", "utf8");

    const restored = recoverAllDisabledNestedGit();
    expect(restored).toBeGreaterThanOrEqual(0);

    rmSync(here, { recursive: true, force: true });
  });
});

describe("ShadowGit class (requires git)", () => {
  const skipIfNoGit = gitAvailable() ? it : it.skip;
  let work: string;
  let gitDir: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "x-agent-shadow-git-class-"));
    gitDir = mkdtempSync(join(tmpdir(), "x-agent-shadow-git-gd-"));
    writeFileSync(join(work, "hello.txt"), "v1\n", "utf8");
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
    rmSync(gitDir, { recursive: true, force: true });
  });

  skipIfNoGit("ensureRepo -> isReady -> commit empty worktree succeeds", async () => {
    const sg = new ShadowGit(work, gitDir);
    const r = await sg.ensureRepo();
    expect(r.ok).toBe(true);
    expect(sg.isReady()).toBe(true);
    const c = await sg.commit("init");
    expect(c.ok).toBe(true);
    if (c.sha) {
      expect(c.sha).toMatch(/^[a-f0-9]{40}$/);
    }
  });

  skipIfNoGit("commit after file write produces a sha and revParse returns it", async () => {
    const sg = new ShadowGit(work, gitDir);
    await sg.ensureRepo();
    writeFileSync(join(work, "hello.txt"), "v2\n", "utf8");
    const c = await sg.commit("update");
    expect(c.ok).toBe(true);
    expect(c.sha).toBeTruthy();
    const parsed = await sg.revParse("HEAD");
    expect(parsed).toBe(c.sha);
  });

  skipIfNoGit("diffPaths lists the changed file between two commits", async () => {
    const sg = new ShadowGit(work, gitDir);
    await sg.ensureRepo();
    const c1 = await sg.commit("first");
    writeFileSync(join(work, "hello.txt"), "v2\n", "utf8");
    const c2 = await sg.commit("second");
    const diff = await sg.diffPaths(c1.sha, c2.sha);
    expect(diff.ok).toBe(true);
    expect(diff.paths).toContain("hello.txt");
  });

  skipIfNoGit("restore(sha) reverts the worktree to that commit", async () => {
    const sg = new ShadowGit(work, gitDir);
    await sg.ensureRepo();
    const c1 = await sg.commit("v1");
    writeFileSync(join(work, "hello.txt"), "v2\n", "utf8");
    await sg.commit("v2");
    const restore = await sg.restore(c1.sha);
    expect(restore.ok).toBe(true);
    const after = readFileSync(join(work, "hello.txt"), "utf8");
    expect(after).toBe("v1\n");
  });
});
