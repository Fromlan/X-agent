/**
 * Documents / guards the Pi persistence timing that broke retract baselines:
 * sessionManager.appendMessage runs AFTER message_end listeners, so binding
 * activeUserEntryId on message_start pointed at the previous user (or null).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TurnFileTracker } from "../electron/agent/turn-file-tracker";
import { ShadowCheckpointTracker } from "../electron/agent/shadow-checkpoints";
import { setAgentDirOverrideForTests } from "../electron/agent/prefs";
import { resetGitExecCacheForTests } from "../electron/agent/git-exec";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const agentHome = mkdtempSync(join(tmpdir(), "x-agent-bind-agent-"));
const work = mkdtempSync(join(tmpdir(), "x-agent-bind-work-"));
setAgentDirOverrideForTests(agentHome);
resetGitExecCacheForTests();

try {
  writeFileSync(join(work, "enemy.gd"), "hp = 3\n", "utf8");

  const fileTracker = new TurnFileTracker();
  fileTracker.setCwd(work);

  // Simulate BUG: message_start binds previous/null user before append.
  // First turn: currentUserEntryId() === undefined → no active id → no baseline.
  assert(fileTracker.getActiveUserEntryId() === null, "start null");
  fileTracker.captureBeforeTool("edit", { path: "enemy.gd" });
  assert(!fileTracker.hasBaseline("enemy.gd"), "no capture without active id");

  // Correct order (post-append): bind then capture.
  fileTracker.setActiveUserEntryId("u-new");
  fileTracker.captureBeforeTool("edit", { path: "enemy.gd" });
  assert(fileTracker.hasBaseline("enemy.gd", "u-new"), "capture with correct id");

  writeFileSync(join(work, "enemy.gd"), "hp = 2\n", "utf8");
  const sm = {
    getBranch: () => [
      {
        type: "message",
        id: "u-new",
        message: { role: "user", content: [{ type: "text", text: "改血量" }] },
      },
      {
        type: "message",
        id: "a1",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "t1",
              name: "edit",
              arguments: { path: "enemy.gd", edits: [] },
            },
          ],
        },
      },
    ],
    getEntries: () => [],
    appendCustomEntry: () => "c",
  };
  // 走 RestoreSource seam: scan → preview.
  const scan = fileTracker.scan(sm, "u-new");
  const preview = await fileTracker.preview(sm, "u-new", scan);
  assert(preview.restorablePaths.includes("enemy.gd"), "restorable with correct bind");
  assert(preview.unrestorablePaths.length === 0, "no unrestorable");

  // Wrong-id binding: baselines under u-old, retract u-new → unrestorable.
  const wrong = new TurnFileTracker();
  wrong.setCwd(work);
  wrong.setActiveUserEntryId("u-old");
  writeFileSync(join(work, "enemy.gd"), "hp = 3\n", "utf8");
  wrong.captureBeforeTool("edit", { path: "enemy.gd" });
  writeFileSync(join(work, "enemy.gd"), "hp = 2\n", "utf8");
  const badScan = wrong.scan(sm, "u-new");
  const badPreview = await wrong.preview(sm, "u-new", badScan);
  assert(
    badPreview.unrestorablePaths.includes("enemy.gd"),
    "wrong active id → missing baseline for retract target",
  );

  // Shadow: pending pre must bind to the NEW entry, not a previous one.
  const shadow = new ShadowCheckpointTracker();
  await shadow.setCwd(work);
  if (shadow.enabledShadow) {
    await shadow.preparePromptCheckpoint();
    // Mistakenly binding to previous id would leave u-new without pre.
    shadow.bindPendingPre("u-old");
    assert(shadow.getCheckpoint("u-old")?.pre, "old got pre");
    assert(!shadow.getCheckpoint("u-new")?.pre, "new missing after wrong bind");
    // Correct: prepare again and bind new.
    await shadow.preparePromptCheckpoint();
    shadow.bindPendingPre("u-new");
    assert(shadow.getCheckpoint("u-new")?.pre, "new got pre");
    const sha = shadow.resolveRestoreSha(sm, "u-new");
    assert(sha, "resolve sha for new");
  }

  console.log("session-bind-timing ok");
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
