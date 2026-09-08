/**
 * Vitest 套件 —— src/hooks/event-router 4 个子模块 (issue #61 主题 F C-207).
 *
 * 锁住每个子模块的副作用契约:
 * 1. `applyApiPhaseEvent` —— 4 phase 状态机
 * 2. `applyUsageEvent` —— usage_update / compaction / queue_update
 * 3. `applySessionMetaEvent` —— session_info 多 setter 联动
 * 4. `applyTranscriptEvent` —— history_replace + applyAgentEvent
 */
import { describe, it, expect, vi } from "vitest";
import type {
  AgentStatus,
  GoalInfo,
  UiAgentEvent,
} from "@shared/ipc";
import { applyApiPhaseEvent } from "./api-phase";
import { applyUsageEvent } from "./usage";
import { applySessionMetaEvent } from "./session-meta";
import { applyTranscriptEvent } from "./transcript";

// ─── applyApiPhaseEvent ────────────────────────────────────────────────

describe("applyApiPhaseEvent", () => {
  function makeOnApiStatus() {
    const calls: ({ phase: "thinking" | "receiving" | "retrying"; startedAt: number } | null)[] =
      [];
    const onApiStatus = (s: { phase: "thinking" | "receiving" | "retrying"; startedAt: number } | null) => {
      calls.push(s);
    };
    return { onApiStatus, calls };
  }

  it("assistant_start → thinking + startedAt=now", () => {
    const { onApiStatus, calls } = makeOnApiStatus();
    const before = Date.now();
    const handled = applyApiPhaseEvent({ type: "assistant_start" }, onApiStatus);
    const after = Date.now();
    expect(handled).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.phase).toBe("thinking");
    expect(calls[0]!.startedAt).toBeGreaterThanOrEqual(before);
    expect(calls[0]!.startedAt).toBeLessThanOrEqual(after);
  });

  it("text_delta / thinking_delta → receiving + startedAt=0", () => {
    for (const type of ["text_delta", "thinking_delta"] as const) {
      const { onApiStatus, calls } = makeOnApiStatus();
      const handled = applyApiPhaseEvent({ type } as UiAgentEvent, onApiStatus);
      expect(handled).toBe(true);
      expect(calls[0]).toEqual({ phase: "receiving", startedAt: 0 });
    }
  });

  it("agent_end → null", () => {
    const { onApiStatus, calls } = makeOnApiStatus();
    const handled = applyApiPhaseEvent(
      { type: "agent_end", willRetry: false } as UiAgentEvent,
      onApiStatus,
    );
    expect(handled).toBe(true);
    expect(calls[0]).toBeNull();
  });

  it("status: retrying → retrying", () => {
    const { onApiStatus, calls } = makeOnApiStatus();
    const handled = applyApiPhaseEvent(
      { type: "status", status: "retrying" } as UiAgentEvent,
      onApiStatus,
    );
    expect(handled).toBe(true);
    expect(calls[0]!.phase).toBe("retrying");
  });

  it("status: idle / error → null", () => {
    for (const status of ["idle", "error"] as AgentStatus[]) {
      const { onApiStatus, calls } = makeOnApiStatus();
      applyApiPhaseEvent(
        { type: "status", status } as UiAgentEvent,
        onApiStatus,
      );
      expect(calls[0]).toBeNull();
    }
  });

  it("status: streaming → 不调 onApiStatus (保持当前 phase)", () => {
    const { onApiStatus, calls } = makeOnApiStatus();
    const handled = applyApiPhaseEvent(
      { type: "status", status: "streaming" } as UiAgentEvent,
      onApiStatus,
    );
    expect(handled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("不相关 event (如 usage_update) → 返回 false, 不调 onApiStatus", () => {
    const { onApiStatus, calls } = makeOnApiStatus();
    const handled = applyApiPhaseEvent(
      { type: "usage_update" } as unknown as UiAgentEvent,
      onApiStatus,
    );
    expect(handled).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

// ─── applyUsageEvent ──────────────────────────────────────────────────

// 副作用依赖 setSessionUsage / setCompacting / setQueuedSteering. 这
// 些是 module-level store, 我们 import 实际的 chat-store 测试它们.
import {
  getSessionUsageState,
  getCompacting,
  setSessionUsage,
  setCompacting,
} from "../../stores/session-usage-store";

describe("applyUsageEvent", () => {
  function resetStores() {
    setSessionUsage(null);
    setCompacting(false);
  }

  it("usage_update → setSessionUsage(event.usage)", () => {
    resetStores();
    const usage = { context: { percent: 50 } } as never;
    const handled = applyUsageEvent(
      { type: "usage_update", usage } as UiAgentEvent,
      { setQueuedSteering: vi.fn() },
    );
    expect(handled).toBe(true);
    expect(getSessionUsageState()).toEqual(usage);
  });

  it("compaction_start → setCompacting(true)", () => {
    resetStores();
    applyUsageEvent(
      { type: "compaction_start" } as UiAgentEvent,
      { setQueuedSteering: vi.fn() },
    );
    expect(getCompacting()).toBe(true);
  });

  it("compaction_end → setCompacting(false)", () => {
    setCompacting(true);
    applyUsageEvent(
      { type: "compaction_end" } as UiAgentEvent,
      { setQueuedSteering: vi.fn() },
    );
    expect(getCompacting()).toBe(false);
  });

  it("queue_update → setQueuedSteering(event.steering)", () => {
    const setQueuedSteering = vi.fn();
    const handled = applyUsageEvent(
      { type: "queue_update", steering: ["a", "b"] } as UiAgentEvent,
      { setQueuedSteering },
    );
    expect(handled).toBe(true);
    expect(setQueuedSteering).toHaveBeenCalledWith(["a", "b"]);
  });

  it("不相关 event → 返回 false, 不调任何 setter", () => {
    const setQueuedSteering = vi.fn();
    const handled = applyUsageEvent(
      { type: "assistant_start" } as UiAgentEvent,
      { setQueuedSteering },
    );
    expect(handled).toBe(false);
    expect(setQueuedSteering).not.toHaveBeenCalled();
  });
});

// ─── applySessionMetaEvent ────────────────────────────────────────────

describe("applySessionMetaEvent", () => {
  function makeDeps() {
    return {
      setStatus: vi.fn(),
      setError: vi.fn(),
      setCwd: vi.fn(),
      setSessionId: vi.fn(),
      sessionIdRef: { current: null as string | null },
      setSessionType: vi.fn(),
      setPrefs: vi.fn(),
      setAvailableThinkingLevels: vi.fn(),
      setQueuedSteering: vi.fn(),
      setSessionMode: vi.fn(),
      setPlanPath: vi.fn(),
      setGoal: vi.fn(),
      refreshSessions: vi.fn().mockResolvedValue(undefined),
      usageFetchGen: { current: 0 },
    };
  }

  it("status: idle → setStatus + setError(null)", () => {
    const deps = makeDeps();
    applySessionMetaEvent(
      { type: "status", status: "idle" } as UiAgentEvent,
      deps,
    );
    expect(deps.setStatus).toHaveBeenCalledWith("idle");
    expect(deps.setError).toHaveBeenCalledWith(null);
  });

  it("status: error + event.error → setError(translateError(event.error))", () => {
    const deps = makeDeps();
    applySessionMetaEvent(
      {
        type: "status",
        status: "error",
        error: "internal_failure",
      } as UiAgentEvent,
      deps,
    );
    expect(deps.setStatus).toHaveBeenCalledWith("error");
    // translateError 不一定在测试中翻译, 至少不是 raw key
    expect(deps.setError).toHaveBeenCalled();
    const arg = deps.setError.mock.calls[0]![0] as string;
    expect(arg).not.toBe("internal_failure");
  });

  it("session_info: 首次 sessionId → setCwd/setSessionId/setSessionType/clear usage/setQueuedSteering([])", () => {
    const deps = makeDeps();
    deps.sessionIdRef.current = null;
    applySessionMetaEvent(
      {
        type: "session_info",
        sessionId: "s1",
        cwd: "/proj",
        sessionType: "code",
        thinkingLevel: "high",
        availableThinkingLevels: [],
        sessionPath: "/path",
        model: { provider: "p", id: "m" },
      } as unknown as UiAgentEvent,
      deps,
    );
    expect(deps.setCwd).toHaveBeenCalledWith("/proj");
    expect(deps.setSessionId).toHaveBeenCalledWith("s1");
    expect(deps.sessionIdRef.current).toBe("s1");
    expect(deps.setSessionType).toHaveBeenCalledWith("code");
    expect(deps.usageFetchGen.current).toBe(1);
    expect(deps.setQueuedSteering).toHaveBeenCalledWith([]);
    expect(deps.setAvailableThinkingLevels).toHaveBeenCalledWith(null);
    expect(deps.setPrefs).toHaveBeenCalled();
  });

  it("session_info: 同 sessionId (prev === next) → 不 bump usage gen, 不清 steering", () => {
    const deps = makeDeps();
    deps.sessionIdRef.current = "s1";
    applySessionMetaEvent(
      {
        type: "session_info",
        sessionId: "s1",
        cwd: "/proj",
        thinkingLevel: "high",
        availableThinkingLevels: ["high"],
        sessionPath: null,
        model: { provider: "p", id: "m" },
      } as unknown as UiAgentEvent,
      deps,
    );
    expect(deps.usageFetchGen.current).toBe(0);
    expect(deps.setQueuedSteering).not.toHaveBeenCalled();
    expect(deps.setAvailableThinkingLevels).toHaveBeenCalledWith(["high"]);
  });

  it("session_title → refreshSessions", () => {
    const deps = makeDeps();
    applySessionMetaEvent(
      { type: "session_title", title: "x" } as UiAgentEvent,
      deps,
    );
    expect(deps.refreshSessions).toHaveBeenCalled();
  });

  it("session_mode → setSessionMode + setPlanPath", () => {
    const deps = makeDeps();
    applySessionMetaEvent(
      {
        type: "session_mode",
        mode: "plan",
        planPath: "/plan.md",
      } as UiAgentEvent,
      deps,
    );
    expect(deps.setSessionMode).toHaveBeenCalledWith("plan");
    expect(deps.setPlanPath).toHaveBeenCalledWith("/plan.md");
  });

  it("goal_update → setGoal", () => {
    const deps = makeDeps();
    const g: GoalInfo = {
      condition: "x",
      status: "pursuing",
      turns: 1,
      maxTurns: 20,
      tokensUsed: 100,
      maxTokens: 500000,
    };
    applySessionMetaEvent(
      { type: "goal_update", goal: g } as UiAgentEvent,
      deps,
    );
    expect(deps.setGoal).toHaveBeenCalledWith(g);
  });

  it("agent_end (willRetry=false) → refreshSessions", () => {
    const deps = makeDeps();
    applySessionMetaEvent(
      { type: "agent_end", willRetry: false } as UiAgentEvent,
      deps,
    );
    expect(deps.refreshSessions).toHaveBeenCalled();
  });

  it("agent_end (willRetry=true) → 不调 refreshSessions", () => {
    const deps = makeDeps();
    applySessionMetaEvent(
      { type: "agent_end", willRetry: true } as UiAgentEvent,
      deps,
    );
    expect(deps.refreshSessions).not.toHaveBeenCalled();
  });

  it("不相关 event (text_delta) → 返回 false", () => {
    const deps = makeDeps();
    const handled = applySessionMetaEvent(
      { type: "text_delta", delta: "x" } as UiAgentEvent,
      deps,
    );
    expect(handled).toBe(false);
    expect(deps.setStatus).not.toHaveBeenCalled();
  });
});

// ─── applyTranscriptEvent ─────────────────────────────────────────────

describe("applyTranscriptEvent", () => {
  it("history_replace: editingEntryId 不在 items 中 → 清 null", () => {
    const setItems = vi.fn();
    const setEditingEntryId = vi.fn();
    applyTranscriptEvent(
      {
        type: "history_replace",
        items: [
          { kind: "user", id: "u1", text: "hi" },
        ],
      } as unknown as UiAgentEvent,
      { setItems, setEditingEntryId },
    );
    expect(setEditingEntryId).toHaveBeenCalled();
    // 检查 setEditingEntryId 接受的 updater
    const updater = setEditingEntryId.mock.calls[0]![0] as (
      prev: string | null,
    ) => string | null;
    expect(updater("u-not-in-list")).toBeNull();
    expect(updater(null)).toBeNull();
  });

  it("history_replace: editingEntryId 命中 items (by id) → 保留", () => {
    const setItems = vi.fn();
    const setEditingEntryId = vi.fn();
    applyTranscriptEvent(
      {
        type: "history_replace",
        items: [
          { kind: "user", id: "u1", entryId: "u1", text: "hi" },
        ],
      } as unknown as UiAgentEvent,
      { setItems, setEditingEntryId },
    );
    const updater = setEditingEntryId.mock.calls[0]![0] as (
      prev: string | null,
    ) => string | null;
    expect(updater("u1")).toBe("u1");
  });

  it("history_replace: editingEntryId 命中 items (by entryId) → 保留", () => {
    const setItems = vi.fn();
    const setEditingEntryId = vi.fn();
    applyTranscriptEvent(
      {
        type: "history_replace",
        items: [
          { kind: "user", id: "u1", entryId: "u-mine", text: "hi" },
        ],
      } as unknown as UiAgentEvent,
      { setItems, setEditingEntryId },
    );
    const updater = setEditingEntryId.mock.calls[0]![0] as (
      prev: string | null,
    ) => string | null;
    expect(updater("u-mine")).toBe("u-mine");
  });

  it("setItems 总是被调 (applyAgentEvent 收口)", () => {
    const setItems = vi.fn();
    const setEditingEntryId = vi.fn();
    applyTranscriptEvent(
      { type: "user_message", text: "hi" } as unknown as UiAgentEvent,
      { setItems, setEditingEntryId },
    );
    expect(setItems).toHaveBeenCalled();
  });
});
