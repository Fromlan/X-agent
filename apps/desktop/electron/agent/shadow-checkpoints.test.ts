/**
 * Vitest 套件 —— 覆盖 ROADMAP 1.1 首批关键模块迁移：shadow-checkpoints。
 *
 * 与 `scripts/test-shadow-git.ts`（离线断言脚本）并存；依赖真实 git 二进制，
 * git 不可用（Windows 未装 Git for Windows）时整组跳过。
 * 注意：用模块级 top-level await 探测 git 并 `describe.skipIf`，因为
 * `it.skipIf` 在收集期同步求值，无法等 beforeAll 的异步结果。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setAgentDirOverrideForTests } from "./prefs";
import { isGitAvailable, resetGitExecCacheForTests } from "./git-exec";
import { ShadowGit } from "./shadow-git";
import {
  SHADOW_CHECKPOINT_CUSTOM_TYPE,
  ShadowCheckpointTracker,
  type TurnCheckpoint,
} from "./shadow-checkpoints";

const gitAvailable = await isGitAvailable();

/** 记录 shadow 用 getAgentDirPath 前缀的 checkpoint 根，方便按需删除。 */
let agentHome = "";
let work = "";

function makeSm() {
  const customEntries: Array<{
    type: string;
    customType?: string;
    data?: unknown;
  }> = [];
  const sm = {
    getBranch: () => [
      { type: "message", id: "u1", message: { role: "user", content: [] } },
    ],
    getEntries: () => customEntries,
    appendCustomEntry: (customType: string, data?: unknown) => {
      customEntries.push({ type: "custom", customType, data });
      return `c-${customEntries.length}`;
    },
  };
  return { sm, customEntries };
}

describe.skipIf(!gitAvailable)("ShadowGit + ShadowCheckpointTracker（需要 git）", () => {
  beforeAll(async () => {
    agentHome = mkdtempSync(join(tmpdir(), "x-agent-shadow-agent-"));
    work = mkdtempSync(join(tmpdir(), "x-agent-shadow-work-"));
    setAgentDirOverrideForTests(agentHome);
    resetGitExecCacheForTests();
    writeFileSync(join(work, "a.txt"), "v1", "utf8");
    mkdirSync(join(work, "sub"), { recursive: true });
    writeFileSync(join(work, "sub", "b.txt"), "b1", "utf8");
  });

  afterAll(() => {
    setAgentDirOverrideForTests(null);
    resetGitExecCacheForTests();
    try {
      rmSync(agentHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("commit / diff / restore 还原工作区", async () => {
    const gitDir = join(agentHome, "x-agent", "checkpoints", "test-repo");
    const shadow = new ShadowGit(work, gitDir);
    const init = await shadow.ensureRepo();
    expect(init.ok).toBe(true);

    const pre = await shadow.commit("pre");
    expect(pre.ok).toBe(true);
    if (pre.ok) expect(pre.sha.length).toBeGreaterThanOrEqual(7);

    writeFileSync(join(work, "a.txt"), "v2", "utf8");
    writeFileSync(join(work, "c.txt"), "created", "utf8");
    rmSync(join(work, "sub", "b.txt"));

    const post = await shadow.commit("post");
    expect(post.ok).toBe(true);
    if (post.ok && pre.ok) expect(post.sha).not.toBe(pre.sha);

    const diff = await shadow.diffPaths(pre.sha, post.sha);
    expect(diff.ok).toBe(true);
    expect(diff.paths.includes("a.txt")).toBe(true);
    expect(diff.paths.includes("c.txt")).toBe(true);
    expect(
      diff.paths.some((p) => p.replace(/\\/g, "/").endsWith("sub/b.txt")),
    ).toBe(true);

    const restored = await shadow.restore(pre.sha);
    expect(restored.ok).toBe(true);
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("v1");
    expect(existsSync(join(work, "sub", "b.txt"))).toBe(true);
    expect(readFileSync(join(work, "sub", "b.txt"), "utf8")).toBe("b1");
    expect(existsSync(join(work, "c.txt"))).toBe(false);

    shadow.destroy();
  });

  it("prepare → bind → post → restoreToUserTurn", async () => {
    writeFileSync(join(work, "a.txt"), "again", "utf8");
    const tracker = new ShadowCheckpointTracker();
    await tracker.setCwd(work);
    expect(tracker.enabledShadow).toBe(true);

    await tracker.preparePromptCheckpoint();
    tracker.bindPendingPre("u1");
    expect(tracker.getCheckpoint("u1")?.pre).toBeTruthy();

    writeFileSync(join(work, "a.txt"), "mutated", "utf8");
    writeFileSync(join(work, "d.txt"), "d", "utf8");
    await tracker.capturePost("u1");
    expect(tracker.getCheckpoint("u1")?.post).toBeTruthy();

    const { sm, customEntries } = makeSm();
    tracker.persistDirty(sm);
    expect(
      customEntries.some((e) => e.customType === SHADOW_CHECKPOINT_CUSTOM_TYPE),
    ).toBe(true);

    const restore = await tracker.restoreToUserTurn(sm, "u1", ["u1"]);
    expect(restore.used).toBe("shadow");
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("again");
    expect(existsSync(join(work, "d.txt"))).toBe(false);
  });

  it("capturePost 不臆造 pre=post", async () => {
    writeFileSync(join(work, "a.txt"), "nopre", "utf8");
    const tracker = new ShadowCheckpointTracker();
    await tracker.setCwd(work);
    await tracker.capturePost("u-orphan");
    expect(tracker.getCheckpoint("u-orphan")?.pre).toBeUndefined();
    expect(tracker.getCheckpoint("u-orphan")?.post).toBeTruthy();
  });

  it("resolveRestoreSha 优先目标 turn 的 pre，否则回溯上一个 post", async () => {
    const tracker = new ShadowCheckpointTracker();
    const branch = [
      { type: "message", id: "u0", message: { role: "user", content: [] } },
      { type: "message", id: "u1", message: { role: "user", content: [] } },
    ];
    const sm = {
      getBranch: () => branch,
      getEntries: () => [],
      appendCustomEntry: () => "c",
    };
    // u0 无 pre，但 u0 的 post 存在 → 回退用 u0.post
    (tracker as unknown as { turns: Map<string, TurnCheckpoint> }).turns.set(
      "u0",
      { post: "post-sha-0" },
    );
    expect(tracker.resolveRestoreSha(sm, "u1")).toBe("post-sha-0");
    // 目标有 pre 时优先自身
    (tracker as unknown as { turns: Map<string, TurnCheckpoint> }).turns.set(
      "u1",
      { pre: "pre-sha-1" },
    );
    expect(tracker.resolveRestoreSha(sm, "u1")).toBe("pre-sha-1");
  });

  it("loadFromSession 恢复已持久化检查点", async () => {
    const { sm, customEntries } = makeSm();
    const tracker = new ShadowCheckpointTracker();
    await tracker.setCwd(work);
    await tracker.preparePromptCheckpoint();
    tracker.bindPendingPre("u1");
    tracker.persistDirty(sm);

    const tracker2 = new ShadowCheckpointTracker();
    await tracker2.setCwd(work);
    tracker2.loadFromSession(sm);
    expect(tracker2.getCheckpoint("u1")?.pre).toBeTruthy();
  });

  it("B2: 路径级还原保留用户手动编辑（回合外 / agent 未碰路径）", async () => {
    writeFileSync(join(work, "f.txt"), "f1", "utf8");
    writeFileSync(join(work, "h.txt"), "h1", "utf8");
    const tracker = new ShadowCheckpointTracker();
    await tracker.setCwd(work);
    await tracker.preparePromptCheckpoint();
    tracker.bindPendingPre("u1");

    // agent 改动：改 f.txt + 新建 g.txt；用户回合内改 h.txt（agent 未碰）
    writeFileSync(join(work, "f.txt"), "f2-agent", "utf8");
    writeFileSync(join(work, "g.txt"), "g-new", "utf8");
    writeFileSync(join(work, "h.txt"), "h1-user-edited", "utf8");
    await tracker.capturePost("u1");

    // 用户在 post 之后手动新建文件（不在 target→HEAD diff 中）
    writeFileSync(join(work, "user-notes.txt"), "keep me", "utf8");

    const { sm } = makeSm();
    const restore = await tracker.restoreToUserTurn(sm, "u1", ["u1"]);
    expect(restore.used).toBe("shadow");
    // agent 改过的路径还原；agent 新建文件删除
    expect(readFileSync(join(work, "f.txt"), "utf8")).toBe("f1");
    expect(existsSync(join(work, "g.txt"))).toBe(false);
    // 回合后手动新建的文件保留（全量 reset --hard 会删除它）
    expect(readFileSync(join(work, "user-notes.txt"), "utf8")).toBe("keep me");
    // 回合内未动过的文件（d.txt 场景外）不受影响
    expect(existsSync(join(work, "sub", "b.txt"))).toBe(true);
  });

  it("recoverDisabledNestedGit 恢复被禁用的嵌套 .git", async () => {
    const nest = join(work, "vendor-lib");
    const disabledGit = join(nest, ".git.__xagent_shadow__");
    mkdirSync(disabledGit, { recursive: true });
    writeFileSync(join(disabledGit, "HEAD"), "ref: refs/heads/main\n", "utf8");
    const { recoverDisabledNestedGit } = await import("./shadow-git");
    recoverDisabledNestedGit(work);
    expect(existsSync(join(nest, ".git", "HEAD"))).toBe(true);
    expect(existsSync(disabledGit)).toBe(false);
  });
});
