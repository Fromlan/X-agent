/** Exercise live Pi event accounting through SessionHost and the real Goal controller. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { GoalInfo } from "../../shared/ipc";
import { SessionHost } from "./session-host";
import type { SessionBundle } from "./session-lifecycle";
import type { SessionModeController } from "./session-mode/controller";
import type { SessionEventBridgeDeps } from "./session-event-bridge";
import { bridgeSessionEvents } from "./session-event-bridge";
import { setAgentDirOverrideForTests } from "./prefs";
import { getUsageSummary, getUsageStorePath, setUsageStorePathForTests } from "./usage-store";
import { withStoreLock } from "./lib/store-mutex";
import { loadGoalLedger } from "./session-mode/goal-journal";

vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => false } }));

type HostTestSeam = {
  bundle: SessionBundle | null;
  sessionMode: SessionModeController;
  buildEventBridgeDeps(): SessionEventBridgeDeps;
  ensureRuntime(): Promise<ModelRuntime>;
  emitUsageUpdate(): void;
  emitHistoryReplace(): void;
  maybeAutoTitleSession(): Promise<void>;
  autoMaintainIfNeeded(): Promise<void>;
};

/** Give each actual model request a distinct identity and nonzero paid usage. */
function assistant(id: string, tokens: number, stopReason = "stop") {
  return {
    role: "assistant",
    id,
    stopReason,
    content: [{ type: "text", text: "still working" }],
    usage: {
      input: tokens - 10, output: 10, cacheRead: 0, cacheWrite: 0,
      totalTokens: tokens,
      cost: { input: 0.01, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
    },
  };
}

describe("Goal budget — live user turn accounting", () => {
  let taskDir: string;
  beforeEach(() => {
    taskDir = mkdtempSync(join(tmpdir(), "x-agent-goal-events-"));
    setAgentDirOverrideForTests(taskDir);
    setUsageStorePathForTests(join(taskDir, "usage.json"));
  });
  afterEach(async () => {
    // Complete fire-and-forget bridge writes before changing their lazy path or deleting the profile.
    await withStoreLock(getUsageStorePath(), async () => undefined);
    setAgentDirOverrideForTests(null);
    setUsageStorePathForTests(null);
    rmSync(taskDir, { recursive: true, force: true });
  });

  /** Keep Pi transport/checkpoints mocked while retaining real bridge, host adapters and Goal ledger. */
  function fixture(maxTokens = 1_000) {
    const host = new SessionHost(() => null);
    const seam = host as unknown as HostTestSeam;
    let handler!: (event: unknown) => void;
    let activeUid = "u1";
    let statsTokens = 0;
    const fakeSession = {
      sessionId: "goal-events",
      isStreaming: false,
      model: { provider: "test", id: "test-model" },
      messages: [],
      getSessionStats: () => ({ tokens: { input: statsTokens, output: 0, cacheRead: 0, cacheWrite: 0, total: statsTokens }, cost: 0.02 }),
      getActiveToolNames: () => ["read"],
      setActiveToolsByName: vi.fn(),
      sessionManager: {
        getLeafEntry: () => ({ id: activeUid, type: "message", message: { role: "user" } }),
        getBranch: () => [],
        appendCustomEntry: vi.fn(),
      },
      subscribe: (next: (event: unknown) => void) => { handler = next; return () => {}; },
    };
    const sessionPath = join(taskDir, "fixture.jsonl");
    seam.bundle = { session: fakeSession as unknown as AgentSession, cwd: taskDir, sessionPath, sessionType: "code", unsubscribe: () => {} };
    const evalResult = assistant("eval", 100);
    evalResult.content = [{ type: "text", text: "NO\nmore work needed" }];
    const complete = vi.fn(async () => evalResult);
    seam.ensureRuntime = vi.fn(async () => ({ completeSimple: complete }) as unknown as ModelRuntime);
    seam.emitUsageUpdate = vi.fn();
    seam.emitHistoryReplace = vi.fn();
    seam.maybeAutoTitleSession = vi.fn(async () => {});
    seam.autoMaintainIfNeeded = vi.fn(async () => {});
    host.prompt = vi.fn(async () => ({ ok: true as const }));
    const goal: GoalInfo = { condition: "tests pass", status: "pursuing", turns: 0, maxTurns: 5, tokensUsed: 0, maxTokens, startedAt: 0 };
    seam.sessionMode.setGoalState(goal);
    seam.sessionMode.setAgentMode("goal");
    const deps = seam.buildEventBridgeDeps();
    vi.spyOn(deps.turn.shadowCheckpoints, "flush").mockResolvedValue();
    vi.spyOn(deps.turn.shadowCheckpoints, "capturePost").mockResolvedValue();
    vi.spyOn(deps.turn.shadowCheckpoints, "persistDirty").mockImplementation(() => {});
    vi.spyOn(deps.turn.shadowCheckpoints, "diffForTurn").mockResolvedValue(null);
    vi.spyOn(deps.turn.fileTracker, "persistDirty").mockImplementation(() => {});
    bridgeSessionEvents(fakeSession as unknown as AgentSession, deps);
    /** Replay the same boundary events emitted by Pi across multiple tool iterations. */
    function request(message: unknown) {
      fakeSession.isStreaming = true;
      handler({ type: "turn_start" });
      handler({ type: "message_start", message });
      handler({ type: "message_end", message });
      handler({ type: "turn_end" });
    }
    /** Final settlement stays asynchronous until the checkpoint flush and Goal evaluation finish. */
    async function settle() {
      fakeSession.isStreaming = true;
      handler({ type: "agent_end", willRetry: false });
      await Promise.resolve();
      fakeSession.isStreaming = false;
      handler({ type: "agent_settled" });
      await vi.waitFor(() => expect(seam.sessionMode.getContinueInFlight()).toBe(false));
      await new Promise<void>((resolve) => setImmediate(resolve));
      await vi.waitFor(() => expect(seam.sessionMode.getContinueInFlight()).toBe(false));
    }
    handler({ type: "agent_start" });
    return { host, seam, goal, fakeSession, deps, request, settle, complete, evalResult, sessionPath, push: (event: unknown) => handler(event), setUid: (uid: string) => { activeUid = uid; }, setStats: (tokens: number) => { statsTokens = tokens; } };
  }

  it("sums every assistant request and stops automatic continuation at the threshold", async () => {
    const f = fixture();
    f.request(assistant("a1", 600));
    f.request(assistant("a2", 500));
    expect(f.host.prompt).not.toHaveBeenCalled(); // In-flight requests are allowed to finish.
    await f.settle();
    expect(f.goal.tokensUsed).toBe(1_100);
    expect(f.goal.status).toBe("budget_limited");
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.host.prompt).not.toHaveBeenCalled();
    expect(loadGoalLedger(f.sessionPath)).toEqual([{ userEntryId: "u1", tokens: 1_100, turnIncremented: false }]);
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_100);
  });

  it("keeps paid aborted/error requests across SDK retries", async () => {
    const f = fixture();
    f.request(assistant("a1", 400, "error"));
    f.push({ type: "agent_end", willRetry: true });
    f.push({ type: "agent_start" });
    f.request(assistant("a2", 300, "aborted"));
    f.request(assistant("a3", 500));
    await f.settle();
    expect(f.goal.tokensUsed).toBe(1_200);
    expect(f.goal.status).toBe("budget_limited");
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.host.prompt).not.toHaveBeenCalled();
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_200);
  });

  it("preserves a paused in-flight turn's charge without evaluating or continuing", async () => {
    const f = fixture(2_000);
    f.request(assistant("a1", 600));
    await f.host.pauseGoal();
    f.request(assistant("a2", 500));
    await f.settle();
    expect(f.goal.status).toBe("paused");
    expect(f.goal.tokensUsed).toBe(1_100);
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.host.prompt).not.toHaveBeenCalled();
    expect(loadGoalLedger(f.sessionPath)?.[0].tokens).toBe(1_100);
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_100);
  });

  it("includes SDK/maintenance compaction usage before Goal and deduplicates its end events", async () => {
    const f = fixture();
    f.request(assistant("a1", 600));
    f.setStats(600);
    f.push({ type: "compaction_start", reason: "threshold" });
    f.setStats(1_100);
    const event = { type: "compaction_end", reason: "threshold", result: { summary: "paid summary", firstKeptEntryId: "u1", tokensBefore: 80_000, estimatedTokensAfter: 20_000, usage: assistant("compact", 500).usage }, aborted: false };
    f.push(event);
    f.push(event);
    f.push(structuredClone(event));
    await f.settle();
    expect(f.goal.tokensUsed).toBe(1_100);
    expect(f.goal.status).toBe("budget_limited");
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.host.prompt).not.toHaveBeenCalled();
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_100);
  });

  it("keeps preflight compaction fees until the next user run is bound", async () => {
    const f = fixture(1_100);
    f.request(assistant("first", 600));
    await f.settle();
    expect(f.goal.tokensUsed).toBe(700);
    expect(f.complete).toHaveBeenCalledTimes(1);
    f.setStats(600);
    f.push({ type: "compaction_start", reason: "threshold" });
    f.setStats(1_000);
    f.push({ type: "compaction_end", reason: "threshold", result: { summary: "preflight summary", firstKeptEntryId: "u1", usage: assistant("compact", 400).usage }, aborted: false });
    f.setUid("u2");
    f.push({ type: "agent_start" });
    f.request(assistant("second", 300));
    await f.settle();
    expect(f.goal.tokensUsed).toBe(1_400);
    expect(f.goal.status).toBe("budget_limited");
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.host.prompt).toHaveBeenCalledTimes(1);
    expect(loadGoalLedger(f.sessionPath)).toEqual([
      { userEntryId: "u1", tokens: 700, turnIncremented: true },
      { userEntryId: "u2", tokens: 700, turnIncremented: false },
    ]);
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_400);
  });

  it("records idle manual compaction against the evaluated turn without another evaluation", async () => {
    const f = fixture(2_000);
    f.request(assistant("first", 600));
    await f.settle();
    f.setStats(600);
    f.push({ type: "compaction_start", reason: "manual" });
    f.setStats(900);
    const event = { type: "compaction_end", reason: "manual", result: { usage: assistant("compact", 300).usage }, aborted: false };
    f.push(event);
    f.push(structuredClone(event));
    expect(f.goal.tokensUsed).toBe(1_000);
    expect(f.goal.turns).toBe(1);
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(loadGoalLedger(f.sessionPath)).toEqual([{ userEntryId: "u1", tokens: 1_000, turnIncremented: true }]);
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_000);
    f.seam.sessionMode.rollbackGoalAfterRetract(["u1"]);
    expect(f.goal.tokensUsed).toBe(0);
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_000);
  });

  it("moves only identified pending charges and preserves historical anonymous journal rows", async () => {
    const f = fixture(2_000);
    f.goal.tokensUsed = 50;
    f.seam.sessionMode.setGoalTurnLedger([{ userEntryId: null, tokens: 50, turnIncremented: false }]);
    // Finish the empty initial run before a later prompt's preflight.
    f.goal.status = "paused";
    await f.settle();
    f.goal.status = "pursuing";
    f.setStats(0);
    f.push({ type: "compaction_start", reason: "threshold" });
    f.setStats(300);
    f.push({ type: "compaction_end", reason: "threshold", result: { usage: assistant("compact", 300).usage }, aborted: false });
    const pending = loadGoalLedger(f.sessionPath)!.find((entry) => entry.pendingUsageId);
    expect(pending?.tokens).toBe(300);
    f.setUid("u2");
    f.push({ type: "agent_start" });
    f.request(assistant("second", 400));
    await f.settle();
    expect(f.seam.sessionMode.getGoalTurnLedger().find((entry) => entry.userEntryId === null)?.tokens).toBe(50);
    expect(f.seam.sessionMode.getGoalTurnLedger().some((entry) => entry.pendingUsageId)).toBe(false);
    expect(f.seam.sessionMode.getGoalTurnLedger().find((entry) => entry.userEntryId === "u2")?.tokens).toBe(800);
    expect((await getUsageSummary()).totals.tokens.total).toBe(800);
  });

  it("deduplicates repeated assistant and settled events, preserving actual aggregate charges after retract", async () => {
    const f = fixture(2_000);
    const message = assistant("a1", 600);
    f.request(message);
    f.push({ type: "message_end", message });
    f.push({ type: "message_end", message: structuredClone(message) });
    f.request(assistant("a2", 500));
    await f.settle();
    await f.settle();
    expect(f.goal.tokensUsed).toBe(1_200);
    expect(f.goal.turns).toBe(1);
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.host.prompt).toHaveBeenCalledTimes(1);
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_200);
    f.seam.sessionMode.rollbackGoalAfterRetract(["u1"]);
    expect(f.goal.tokensUsed).toBe(0);
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_200);
  });

  it("counts distinct requests with matching timestamps using their actual provider/model", async () => {
    const f = fixture();
    const { id: _firstId, ...first } = assistant("a1", 600);
    const { id: _secondId, ...second } = assistant("a2", 500);
    f.request({ ...first, timestamp: 123, provider: "original", model: "model-a" });
    f.fakeSession.model = { provider: "selected-later", id: "different" };
    f.request({ ...second, timestamp: 123, provider: "original", model: "model-b" });
    await f.settle();
    expect(f.goal.tokensUsed).toBe(1_100);
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_100);
    const summary = await getUsageSummary();
    expect(summary.byModel.map((entry) => [entry.modelKey, entry.tokens.total])).toEqual([
      ["original/model-a", 600], ["original/model-b", 500],
    ]);
  });

  it("attributes steering requests to their users so retract preserves the earlier charge", async () => {
    const f = fixture(2_000);
    f.request(assistant("a1", 600));
    f.setUid("u-steer");
    f.push({ type: "message_start", message: { role: "user", content: "steering" } });
    f.push({ type: "message_end", message: { role: "user", content: "steering" } });
    f.request(assistant("a2", 500));
    await f.settle();
    expect(f.goal.tokensUsed).toBe(1_200);
    expect(loadGoalLedger(f.sessionPath)).toEqual([
      { userEntryId: "u1", tokens: 600, turnIncremented: false },
      { userEntryId: "u-steer", tokens: 600, turnIncremented: true },
    ]);
    f.seam.sessionMode.rollbackGoalAfterRetract(["u-steer"]);
    expect(f.goal.tokensUsed).toBe(600);
    expect(f.goal.turns).toBe(0);
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_200);
    // A fresh run uses its own total while the real paid aggregate remains intact.
    f.push({ type: "agent_settled" });
    f.setUid("u-new");
    f.push({ type: "agent_start" });
    f.request(assistant("a-new", 300));
    await f.settle();
    expect(f.goal.tokensUsed).toBe(1_000); // Prior branch 600 + new requests/eval 400.
    expect((await getUsageSummary()).totals.tokens.total).toBe(1_600);
  });
});
