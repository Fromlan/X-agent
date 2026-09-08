/**
 * Vitest 套件 —— src/hooks/session-bootstrap-sync (issue #61 主题 F).
 *
 * 锁住 4 个不变量:
 * 1. hasSession=false → 清空 items / queuedSteering / editingEntryId /
 *    editDraft / confirmState + bump usageFetchGen
 * 2. hasSession=true → fetchSessionUsage 调
 * 3. error → setError; status=idle → setError(null)
 * 4. model 同步到 prefs
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncFromHost } from "./session-bootstrap-sync";
import { setSessionUsage } from "../stores/session-usage-store";

type WorkspaceStatus = {
  status: "idle" | "streaming" | "error" | "retrying";
  cwd: string | null;
  sessionId: string | null;
  hasSession: boolean;
  error: string | null;
  model: { provider: string; id: string } | null;
  thinkingLevel: string;
  availableThinkingLevels: string[];
  sessionPath?: string;
};

function installWorkspaceStatus(status: WorkspaceStatus) {
  (globalThis as unknown as {
    window: { xAgent: { workspace: { getStatus: () => Promise<WorkspaceStatus> } } };
  }).window = {
    xAgent: { workspace: { getStatus: async () => status } },
  };
}

function makeDeps() {
  return {
    setStatus: vi.fn(),
    setCwd: vi.fn(),
    setSessionId: vi.fn(),
    sessionIdRef: { current: null as string | null },
    setItems: vi.fn(),
    setQueuedSteering: vi.fn(),
    setEditingEntryId: vi.fn(),
    setEditDraft: vi.fn(),
    setConfirmState: vi.fn(),
    setError: vi.fn(),
    setPrefs: vi.fn(),
    setAvailableThinkingLevels: vi.fn(),
    usageFetchGen: { current: 0 },
    fetchSessionUsage: vi.fn(),
  };
}

describe("syncFromHost —— host 状态同步", () => {
  beforeEach(() => {
    setSessionUsage(null);
  });

  it("hasSession=false → 清空所有会话相关 state + bump usageFetchGen", async () => {
    installWorkspaceStatus({
      status: "idle",
      cwd: null,
      sessionId: null,
      hasSession: false,
      error: null,
      model: null,
      thinkingLevel: "off",
      availableThinkingLevels: [],
    });
    const d = makeDeps();
    d.usageFetchGen.current = 5;
    await syncFromHost(d);
    expect(d.setStatus).toHaveBeenCalledWith("idle");
    expect(d.setCwd).toHaveBeenCalledWith(null);
    expect(d.setSessionId).toHaveBeenCalledWith(null);
    expect(d.setItems).toHaveBeenCalled();
    expect(d.setQueuedSteering).toHaveBeenCalledWith([]);
    expect(d.setEditingEntryId).toHaveBeenCalledWith(null);
    expect(d.setEditDraft).toHaveBeenCalledWith("");
    expect(d.setConfirmState).toHaveBeenCalledWith(null);
    expect(d.usageFetchGen.current).toBe(6);
    expect(d.fetchSessionUsage).not.toHaveBeenCalled();
  });

  it("hasSession=true → fetchSessionUsage 调一次", async () => {
    installWorkspaceStatus({
      status: "idle",
      cwd: "/p",
      sessionId: "s1",
      hasSession: true,
      error: null,
      model: null,
      thinkingLevel: "off",
      availableThinkingLevels: [],
    });
    const d = makeDeps();
    await syncFromHost(d);
    expect(d.fetchSessionUsage).toHaveBeenCalledTimes(1);
    // 不会清空 items / editingEntryId
    expect(d.setItems).not.toHaveBeenCalled();
    expect(d.setEditingEntryId).not.toHaveBeenCalled();
  });

  it("error 字段非空 → setError", async () => {
    installWorkspaceStatus({
      status: "error",
      cwd: null,
      sessionId: null,
      hasSession: false,
      error: "网络断了",
      model: null,
      thinkingLevel: "off",
      availableThinkingLevels: [],
    });
    const d = makeDeps();
    await syncFromHost(d);
    expect(d.setError).toHaveBeenCalledWith("网络断了");
  });

  it("status=idle 且无 error → setError(null) 清掉旧错误", async () => {
    installWorkspaceStatus({
      status: "idle",
      cwd: null,
      sessionId: null,
      hasSession: false,
      error: null,
      model: null,
      thinkingLevel: "off",
      availableThinkingLevels: [],
    });
    const d = makeDeps();
    await syncFromHost(d);
    expect(d.setError).toHaveBeenCalledWith(null);
  });

  it("model 存在 → setPrefs 收到 prev+new 合并", async () => {
    installWorkspaceStatus({
      status: "idle",
      cwd: "/p",
      sessionId: "s1",
      hasSession: true,
      error: null,
      model: { provider: "anthropic", id: "claude-sonnet-4-5" },
      thinkingLevel: "high",
      availableThinkingLevels: ["high", "off"],
    });
    const d = makeDeps();
    await syncFromHost(d);
    expect(d.setPrefs).toHaveBeenCalled();
    const updater = d.setPrefs.mock.calls[0]![0] as (
      prev: unknown,
    ) => unknown;
    const next = updater({
      provider: "old",
      model: "old",
      thinkingLevel: "off",
    });
    expect(next).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      thinkingLevel: "high",
    });
  });

  it("availableThinkingLevels 非空 → 透传; 空 → null (issue #30 fallback)", async () => {
    // case A: 非空
    installWorkspaceStatus({
      status: "idle",
      cwd: "/p",
      sessionId: "s1",
      hasSession: true,
      error: null,
      model: null,
      thinkingLevel: "high",
      availableThinkingLevels: ["high", "off"],
    });
    const dA = makeDeps();
    await syncFromHost(dA);
    expect(dA.setAvailableThinkingLevels).toHaveBeenCalledWith(["high", "off"]);

    // case B: 空 → null
    installWorkspaceStatus({
      status: "idle",
      cwd: "/p",
      sessionId: "s1",
      hasSession: true,
      error: null,
      model: null,
      thinkingLevel: "high",
      availableThinkingLevels: [],
    });
    const dB = makeDeps();
    await syncFromHost(dB);
    expect(dB.setAvailableThinkingLevels).toHaveBeenCalledWith(null);
  });
});
