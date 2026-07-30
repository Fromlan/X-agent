/**
 * Offline integration test for Shadow Git checkpoints.
 * Requires git on PATH (or Windows Git for Windows).
 */
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
import { setAgentDirOverrideForTests } from "../electron/agent/prefs";
import { isGitAvailable, resetGitExecCacheForTests } from "../electron/agent/git-exec";
import { ShadowGit } from "../electron/agent/shadow-git";
import {
  SHADOW_CHECKPOINT_CUSTOM_TYPE,
  ShadowCheckpointTracker,
} from "../electron/agent/shadow-checkpoints";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const agentHome = mkdtempSync(join(tmpdir(), "x-agent-shadow-agent-"));
const work = mkdtempSync(join(tmpdir(), "x-agent-shadow-work-"));
setAgentDirOverrideForTests(agentHome);
resetGitExecCacheForTests();

try {
  if (!(await isGitAvailable())) {
    console.log("shadow-git skip (git not available)");
    process.exit(0);
  }

  writeFileSync(join(work, "a.txt"), "v1", "utf8");
  mkdirSync(join(work, "sub"), { recursive: true });
  writeFileSync(join(work, "sub", "b.txt"), "b1", "utf8");

  const gitDir = join(agentHome, "x-agent", "checkpoints", "test-repo");
  const shadow = new ShadowGit(work, gitDir);
  const init = await shadow.ensureRepo();
  assert(init.ok, `ensureRepo: ${init.error}`);

  const pre = await shadow.commit("pre");
  assert(pre.ok, `pre commit: ${"error" in pre ? pre.error : ""}`);
  assert(pre.ok && pre.sha.length >= 7, "pre sha");

  writeFileSync(join(work, "a.txt"), "v2", "utf8");
  writeFileSync(join(work, "c.txt"), "created", "utf8");
  rmSync(join(work, "sub", "b.txt"));

  const post = await shadow.commit("post");
  assert(post.ok, `post commit failed`);
  assert(post.ok && post.sha !== pre.sha, "post sha differs");

  const diff = await shadow.diffPaths(pre.sha, post.sha);
  assert(diff.ok, `diff: ${diff.error}`);
  assert(diff.paths.includes("a.txt"), "diff a.txt");
  assert(diff.paths.includes("c.txt"), "diff c.txt");
  assert(diff.paths.some((p) => p.replace(/\\/g, "/").endsWith("sub/b.txt")), "diff b.txt");

  const restored = await shadow.restore(pre.sha);
  assert(restored.ok, `restore: ${restored.error}`);
  assert(readFileSync(join(work, "a.txt"), "utf8") === "v1", "a.txt restored");
  assert(existsSync(join(work, "sub", "b.txt")), "b.txt restored");
  assert(readFileSync(join(work, "sub", "b.txt"), "utf8") === "b1", "b.txt content");
  assert(!existsSync(join(work, "c.txt")), "c.txt deleted");

  // Tracker: prepare → bind → mutate → post → restore
  writeFileSync(join(work, "a.txt"), "again", "utf8");
  const tracker = new ShadowCheckpointTracker();
  await tracker.setCwd(work);
  assert(tracker.enabledShadow, "tracker enabled");

  await tracker.preparePromptCheckpoint();
  tracker.bindPendingPre("u1");
  assert(tracker.getCheckpoint("u1")?.pre, "u1 pre bound");

  writeFileSync(join(work, "a.txt"), "mutated", "utf8");
  writeFileSync(join(work, "d.txt"), "d", "utf8");
  await tracker.capturePost("u1");
  assert(tracker.getCheckpoint("u1")?.post, "u1 post");

  const customEntries: Array<{ type: string; customType?: string; data?: unknown }> =
    [];
  const sm = {
    getBranch: () => [
      {
        type: "message",
        id: "u1",
        message: { role: "user", content: [] },
      },
    ],
    getEntries: () => customEntries,
    appendCustomEntry: (customType: string, data?: unknown) => {
      customEntries.push({ type: "custom", customType, data });
      return `c-${customEntries.length}`;
    },
  };
  tracker.persistDirty(sm);
  assert(
    customEntries.some((e) => e.customType === SHADOW_CHECKPOINT_CUSTOM_TYPE),
    "persisted custom entry",
  );

  const restore = await tracker.restoreToUserTurn(sm, "u1", ["u1"]);
  assert(restore.used === "shadow", "used shadow");
  assert(readFileSync(join(work, "a.txt"), "utf8") === "again", "tracker restore a");
  assert(!existsSync(join(work, "d.txt")), "tracker restore deleted d");

  // capturePost must not invent pre=post when prepare/bind was skipped
  writeFileSync(join(work, "a.txt"), "nopre", "utf8");
  const tracker3 = new ShadowCheckpointTracker();
  await tracker3.setCwd(work);
  await tracker3.capturePost("u-orphan");
  assert(!tracker3.getCheckpoint("u-orphan")?.pre, "no invented pre");
  assert(tracker3.getCheckpoint("u-orphan")?.post, "post without pre");

  // Stuck nested-git rename recovery
  const nest = join(work, "vendor-lib");
  const disabledGit = join(nest, ".git.__xagent_shadow__");
  mkdirSync(disabledGit, { recursive: true });
  writeFileSync(join(disabledGit, "HEAD"), "ref: refs/heads/main\n", "utf8");
  const { recoverDisabledNestedGit } = await import(
    "../electron/agent/shadow-git"
  );
  recoverDisabledNestedGit(work);
  assert(existsSync(join(nest, ".git", "HEAD")), "recovered nested .git");
  assert(!existsSync(disabledGit), "disabled suffix removed");

  // Reload from session
  const tracker2 = new ShadowCheckpointTracker();
  await tracker2.setCwd(work);
  tracker2.loadFromSession(sm);
  assert(tracker2.getCheckpoint("u1")?.pre, "loaded pre from session");

  shadow.destroy();
  console.log("shadow-git ok");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
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
}
