/**
 * SessionModeController: pause / budget / eval-failure stop / mutual exclusion.
 * Uses a mock host — no Electron / Pi runtime.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionModeController,
  type SessionModeHost,
} from "../electron/agent/session-mode/index.ts";
import { setAgentDirOverrideForTests } from "../electron/agent/prefs.ts";
import { loadGoalJournal } from "../electron/agent/session-mode/goal-journal.ts";
import type { UiAgentEvent } from "../shared/ipc.ts";

const dir = mkdtempSync(join(tmpdir(), "x-agent-mode-"));
setAgentDirOverrideForTests(dir);

type MockSession = {
  isStreaming: boolean;
  model: { id: string } | null;
  messages: unknown[];
  tools: string[];
  getActiveToolNames: () => string[];
  setActiveToolsByName: (names: string[]) => void;
};

function createHarness(opts?: {
  sessionPath?: string;
}) {
  const events: UiAgentEvent[] = [];
  const notices: string[] = [];
  const prompts: string[] = [];
  const session: MockSession = {
    isStreaming: false,
    model: { id: "test" },
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    tools: ["read", "bash", "write", "edit", "grep", "find", "ls"],
    getActiveToolNames() {
      return this.tools;
    },
    setActiveToolsByName(names) {
      this.tools = [...names];
    },
  };
  let evalResult = {
    stopReason: "stop",
    content: [{ type: "text", text: "NO\nstill working" }],
  };
  const bundle = {
    session: session as never,
    cwd: join(dir, "proj"),
    sessionPath: opts?.sessionPath ?? join(dir, "session.jsonl"),
  };
  let lastTurnTokens = 0;
  let activeUserEntryId: string | null = "user-1";
  const host: SessionModeHost = {
    getBundle: () => bundle,
    getResourceLoader: () => null,
    getBaseAppendPrompt: () => [],
    emit: (e) => {
      events.push(e);
    },
    emitReplaceableNotice: (_k, text) => {
      notices.push(text);
    },
    prompt: async (text) => {
      prompts.push(text);
      return { ok: true };
    },
    ensureRuntime: async () =>
      ({
        completeSimple: async () => evalResult,
      }) as never,
    getLastTurnTokenTotal: () => lastTurnTokens,
    getActiveUserEntryId: () => activeUserEntryId,
  };
  const controller = new SessionModeController(() => host);
  return {
    controller,
    session,
    events,
    notices,
    prompts,
    setEval(result: typeof evalResult) {
      evalResult = result;
    },
    setLastTurnTokens(n: number) {
      lastTurnTokens = n;
    },
    setActiveUserEntryId(id: string | null) {
      activeUserEntryId = id;
    },
  };
}

{
  const sessionPath = join(dir, "s1.jsonl");
  const h = createHarness({ sessionPath });
  // Budget: maxTurns=2
  // Patch prefs via setGoal after writing prefs file through loadPrefs default;
  // setGoal reads goalMaxTurns from prefs — patch via journal after set.
  const set = await h.controller.setGoal("tests pass");
  assert.equal(set.ok, true);
  assert.equal(h.controller.getGoal()?.status, "pursuing");
  // Force tiny budget
  const g = h.controller.getGoal()!;
  g.maxTurns = 2;

  h.setEval({
    stopReason: "stop",
    content: [{ type: "text", text: "NO\nnot yet" }],
  });
  await h.controller.onAgentSettled();
  assert.equal(h.controller.getGoal()?.turns, 1);
  assert.equal(h.controller.getGoal()?.status, "pursuing");
  // Continue is deferred (void prompt after finally) — flush microtasks.
  await Promise.resolve();
  assert.ok(h.prompts.some((p) => p.includes("Goal still unmet")));

  h.setActiveUserEntryId("user-2");
  await h.controller.onAgentSettled();
  assert.equal(h.controller.getGoal()?.status, "budget_limited");
  assert.equal(h.controller.getGoal()?.turns, 2);
  // Journal persisted
  const stored = loadGoalJournal(sessionPath);
  assert.equal(stored?.status, "budget_limited");
}

{
  // Retract rolls back goal turns/tokens for abandoned user entries
  const h = createHarness({ sessionPath: join(dir, "s-retract.jsonl") });
  await h.controller.setGoal("rollback");
  const g = h.controller.getGoal()!;
  g.maxTurns = 10;
  h.setLastTurnTokens(50);
  h.setActiveUserEntryId("u1");
  h.setEval({
    stopReason: "stop",
    content: [{ type: "text", text: "NO\nnot yet" }],
  });
  await h.controller.onAgentSettled();
  await Promise.resolve();
  assert.equal(h.controller.getGoal()?.turns, 1);
  assert.equal(h.controller.getGoal()?.tokensUsed, 50);

  h.setActiveUserEntryId("u2");
  h.setLastTurnTokens(30);
  await h.controller.onAgentSettled();
  await Promise.resolve();
  assert.equal(h.controller.getGoal()?.turns, 2);
  assert.equal(h.controller.getGoal()?.tokensUsed, 80);

  h.controller.rollbackGoalAfterRetract(["u2"]);
  assert.equal(h.controller.getGoal()?.turns, 1);
  assert.equal(h.controller.getGoal()?.tokensUsed, 50);
}

{
  const h = createHarness({ sessionPath: join(dir, "s2.jsonl") });
  await h.controller.setGoal("done");
  const paused = await h.controller.pauseGoal();
  assert.equal(paused.ok, true);
  assert.equal(h.controller.getGoal()?.status, "paused");
  // Settled while paused must not continue
  const promptsBefore = h.prompts.length;
  await h.controller.onAgentSettled();
  assert.equal(h.prompts.length, promptsBefore);
}

{
  const h = createHarness({ sessionPath: join(dir, "s3.jsonl") });
  await h.controller.setGoal("done");
  h.setEval({
    stopReason: "error",
    content: [],
  });
  await h.controller.onAgentSettled();
  assert.equal(h.controller.getGoal()?.status, "paused");
  assert.ok(h.notices.some((n) => n.includes("暂停")));
}

{
  const h = createHarness({ sessionPath: join(dir, "s4.jsonl") });
  await h.controller.setGoal("done");
  h.setEval({
    stopReason: "stop",
    content: [{ type: "text", text: "YES\nall good" }],
  });
  await h.controller.onAgentSettled();
  assert.equal(h.controller.getGoal(), null);
  assert.equal(h.controller.getMode(), "agent");
}

{
  const h = createHarness();
  await h.controller.setGoal("x");
  const mode = await h.controller.setMode("plan");
  assert.equal(mode.ok, true);
  assert.equal(h.controller.getGoal(), null);
  assert.equal(h.controller.getMode(), "plan");
}

{
  // Token budget hits before turn budget
  const h = createHarness({ sessionPath: join(dir, "s-tok.jsonl") });
  await h.controller.setGoal("token budget");
  const g = h.controller.getGoal()!;
  g.maxTokens = 100;
  g.maxTurns = 50;
  h.setLastTurnTokens(120);
  h.setEval({
    stopReason: "stop",
    content: [{ type: "text", text: "NO\nstill" }],
  });
  await h.controller.onAgentSettled();
  assert.equal(h.controller.getGoal()?.status, "budget_limited");
  assert.equal(h.controller.getGoal()?.tokensUsed, 120);
  assert.equal(h.controller.getGoal()?.turns, 0);
}

setAgentDirOverrideForTests(null);
rmSync(dir, { recursive: true, force: true });
console.log("test-session-mode-controller: ok");
