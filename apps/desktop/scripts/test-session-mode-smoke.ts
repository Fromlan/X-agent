/**
 * CI smoke covering SessionModeController + SessionHost-adjacent contracts:
 * budget stop, pause, journal round-trip, and delete clears journal
 * (same helper SessionHost.deleteSession calls).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionModeController,
  type SessionModeHost,
} from "../electron/agent/session-mode.ts";
import { setAgentDirOverrideForTests } from "../electron/agent/prefs.ts";
import {
  clearGoalJournal,
  loadGoalJournal,
  saveGoalJournal,
} from "../electron/agent/goal-journal.ts";
import type { GoalInfo, UiAgentEvent } from "../shared/ipc.ts";

const dir = mkdtempSync(join(tmpdir(), "x-agent-smoke-"));
setAgentDirOverrideForTests(dir);

const sessionPath = join(dir, "sess.jsonl");
const events: UiAgentEvent[] = [];
const prompts: string[] = [];

const session = {
  isStreaming: false,
  model: { id: "mock" },
  messages: [] as unknown[],
  tools: ["read", "bash", "write", "edit", "grep", "find", "ls"],
  getActiveToolNames() {
    return this.tools;
  },
  setActiveToolsByName(names: string[]) {
    this.tools = [...names];
  },
};

let evalResult = {
  stopReason: "stop" as string,
  content: [{ type: "text", text: "NO\nstill going" }],
};

const bundle = {
  session: session as never,
  cwd: join(dir, "proj"),
  sessionPath,
};

const host: SessionModeHost = {
  getBundle: () => bundle,
  getResourceLoader: () => null,
  getBaseAppendPrompt: () => [],
  setBaseAppendPrompt: () => {},
  emit: (e) => {
    events.push(e);
  },
  emitReplaceableNotice: () => {},
  prompt: async (text) => {
    prompts.push(text);
    return { ok: true };
  },
  ensureRuntime: async () =>
    ({
      completeSimple: async () => evalResult,
    }) as never,
  getLastTurnTokenTotal: () => 0,
  getActiveUserEntryId: () => "smoke-user",
};

const controller = new SessionModeController(() => host);

await controller.setGoal("smoke condition");
assert.equal(controller.getGoal()?.status, "pursuing");
assert.ok((controller.getGoal()?.maxTokens ?? 0) >= 10_000);
controller.getGoal()!.maxTurns = 1;
await controller.onAgentSettled();
assert.equal(controller.getGoal()?.status, "budget_limited");

await controller.pauseGoal(); // already budget_limited → reject
const pauseWhileBudget = await controller.pauseGoal();
assert.equal(pauseWhileBudget.ok, false);

// Journal restore path
const stored = loadGoalJournal(sessionPath);
assert.ok(stored);
assert.equal(stored!.status, "budget_limited");

controller.reset({ emit: false });
assert.equal(controller.getGoal(), null);
controller.restoreGoalFromJournal();
assert.equal(controller.getGoal()?.status, "budget_limited");
assert.equal(controller.getMode(), "goal");

clearGoalJournal(sessionPath);
const paused: GoalInfo = {
  condition: "x",
  status: "paused",
  turns: 3,
  maxTurns: 20,
  tokensUsed: 1000,
  maxTokens: 500_000,
  startedAt: Date.now(),
};
saveGoalJournal(sessionPath, paused);
controller.reset({ emit: false });
controller.restoreGoalFromJournal();
assert.equal(controller.getGoal()?.status, "paused");
assert.equal(controller.getGoal()?.tokensUsed, 1000);

// SessionHost.deleteSession contract: removing a session clears its journal.
clearGoalJournal(sessionPath);
assert.equal(loadGoalJournal(sessionPath), null);

setAgentDirOverrideForTests(null);
rmSync(dir, { recursive: true, force: true });
console.log("test-session-mode-smoke: ok");
