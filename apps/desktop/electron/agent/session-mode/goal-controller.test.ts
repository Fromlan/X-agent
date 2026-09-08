/**
 * Vitest 套件 —— GoalController (主题 B-2 / C-404, issue #63).
 *
 * 验证 4 case 中的 goal case 可独立单测 (mock GoalControllerDeps, 不需要
 * 造整个 SessionModeController). 锁住 applyGoalModeChange + computeGoalModeNotice
 * + clearGoalState + setGoal / pauseGoal / resumeGoal / clearGoal 边界.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GoalController, type GoalControllerDeps, type GoalTurnLedgerEntry } from "./goal-controller";
import { setAgentDirOverrideForTests } from "../prefs";
import type { AgentSessionMode, GoalInfo, GoalStatus, SessionModeInfo } from "../../../shared/ipc";
import type { SessionModeHost } from "../host-interfaces";

interface MockDeps extends GoalControllerDeps {
  host: () => SessionModeHost;
  getAgentMode: ReturnType<typeof vi.fn>;
  setAgentMode: ReturnType<typeof vi.fn>;
  takeRestoredTools: ReturnType<typeof vi.fn>;
  refreshSystemPrompt: ReturnType<typeof vi.fn>;
  emitSessionMode: ReturnType<typeof vi.fn>;
  emitGoal: ReturnType<typeof vi.fn>;
  emitModeNotice: ReturnType<typeof vi.fn>;
  getInfo: ReturnType<typeof vi.fn>;
  sessionPath: ReturnType<typeof vi.fn>;
  getGoalState: ReturnType<typeof vi.fn>;
  setGoalState: ReturnType<typeof vi.fn>;
  getContinueInFlight: ReturnType<typeof vi.fn>;
  setContinueInFlight: ReturnType<typeof vi.fn>;
  getGoalGeneration: ReturnType<typeof vi.fn>;
  bumpGoalGeneration: ReturnType<typeof vi.fn>;
  getGoalTurnLedger: ReturnType<typeof vi.fn>;
  setGoalTurnLedger: ReturnType<typeof vi.fn>;
}

function makeMockDeps(opts?: {
  agentMode?: AgentSessionMode;
  goal?: GoalInfo | null;
  hasBundle?: boolean;
  activeTools?: string[];
}): MockDeps & { hostObject: SessionModeHost; ledger: GoalTurnLedgerEntry[] } {
  const activeTools = opts?.activeTools ?? ["read", "write", "bash"];
  const bundle = opts?.hasBundle === false
    ? null
    : {
        session: {
          isStreaming: false,
          model: { id: "test" },
          messages: [],
          tools: [...activeTools],
          getActiveToolNames: () => activeTools,
          setActiveToolsByName: vi.fn(),
        },
        cwd: "D:/proj",
        sessionPath: "D:/proj/sess.jsonl",
        sessionType: "code" as const,
      };
  const hostObject: SessionModeHost = {
    getBundle: () => bundle as never,
    getResourceLoader: () => null,
    getBaseAppendPrompt: () => [],
    emit: vi.fn(),
    emitReplaceableNotice: vi.fn(),
    prompt: vi.fn(async () => ({ ok: true as const })),
    ensureRuntime: vi.fn(async () => ({}) as never),
    getLastTurnTokenTotal: () => 0,
    getActiveUserEntryId: () => null,
  };
  let goal = opts?.goal ?? null;
  let inFlight = false;
  let gen = 0;
  let mode: AgentSessionMode = opts?.agentMode ?? "agent";
  const ledger: GoalTurnLedgerEntry[] = [];
  const deps: MockDeps & { hostObject: SessionModeHost; ledger: GoalTurnLedgerEntry[] } = {
    hostObject,
    ledger,
    host: () => hostObject,
    getAgentMode: vi.fn((): AgentSessionMode => mode),
    setAgentMode: vi.fn((m: AgentSessionMode) => { mode = m; }),
    takeRestoredTools: vi.fn(() => ["read", "bash"]),
    refreshSystemPrompt: vi.fn(),
    emitSessionMode: vi.fn(),
    emitGoal: vi.fn(),
    emitModeNotice: vi.fn(),
    getInfo: vi.fn((): SessionModeInfo => ({
      mode,
      planPath: null,
      tools: activeTools,
    })),
    sessionPath: vi.fn(() => "D:/proj/sess.jsonl"),
    getGoalState: vi.fn(() => goal),
    setGoalState: vi.fn((g: GoalInfo | null) => { goal = g; }),
    getContinueInFlight: vi.fn(() => inFlight),
    setContinueInFlight: vi.fn((v: boolean) => { inFlight = v; }),
    getGoalGeneration: vi.fn(() => gen),
    bumpGoalGeneration: vi.fn(() => { gen += 1; }),
    getGoalTurnLedger: vi.fn(() => ledger),
    setGoalTurnLedger: vi.fn((l: GoalTurnLedgerEntry[]) => { ledger.length = 0; ledger.push(...l); }),
  };
  return deps;
}

describe("GoalController — goal case (C-404)", () => {
  let setupDir: string;

  beforeEach(() => {
    setupDir = `D:/UGit/.scratch/test-goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAgentDirOverrideForTests(setupDir);
  });

  it("applyGoalModeChange: 无 bundle 时 setAgentMode + emitSessionMode (controller 检查 bundle 提前)", () => {
    const deps = makeMockDeps();
    const goal = new GoalController(deps);
    const result = goal.applyGoalModeChange();
    // 没有 bundle 检查 (setMode 上层做), 所以仍能完成路径
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.info.mode).toBe("goal");
      // 没有活跃 goal → needGoalCondition = true
      expect(result.needGoalCondition).toBe(true);
    }
    expect(deps.setAgentMode).toHaveBeenCalledWith("goal");
    expect(deps.emitSessionMode).toHaveBeenCalled();
  });

  it("applyGoalModeChange: 已有 paused goal → needGoalCondition = false", () => {
    const deps = makeMockDeps({
      goal: {
        condition: "ship",
        status: "paused",
        turns: 1,
        maxTurns: 10,
        tokensUsed: 100,
        maxTokens: 10_000,
        startedAt: Date.now() - 1000,
      },
    });
    const goal = new GoalController(deps);
    const result = goal.applyGoalModeChange();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.needGoalCondition).toBe(false);
    }
  });

  it("applyGoalModeChange: 切到 goal 后不 emitGoal (有专门 goal emit 路径)", () => {
    const deps = makeMockDeps();
    const goal = new GoalController(deps);
    goal.applyGoalModeChange();
    // C-107 例外: goal case 不 emit goal
    expect(deps.emitGoal).not.toHaveBeenCalled();
  });

  it("computeGoalModeNotice: 无 goal 时返回 '请输入可验证的完成条件'", () => {
    const deps = makeMockDeps({ goal: null });
    const goal = new GoalController(deps);
    const notice = goal.computeGoalModeNotice(true);
    expect(notice).toContain("目标模式");
    expect(notice).toContain("完成条件");
  });

  it("computeGoalModeNotice: paused goal → '已暂停' 文案", () => {
    const deps = makeMockDeps({
      goal: {
        condition: "ship",
        status: "paused",
        turns: 0,
        maxTurns: 5,
        tokensUsed: 0,
        maxTokens: 1000,
        startedAt: 0,
      },
    });
    const goal = new GoalController(deps);
    const notice = goal.computeGoalModeNotice(false);
    expect(notice).toContain("目标已暂停");
    expect(notice).toContain("ship");
  });

  it("computeGoalModeNotice: budget_limited goal → '已达预算' 文案", () => {
    const deps = makeMockDeps({
      goal: {
        condition: "ship",
        status: "budget_limited",
        turns: 5,
        maxTurns: 5,
        tokensUsed: 8000,
        maxTokens: 10000,
        startedAt: 0,
      },
    });
    const goal = new GoalController(deps);
    const notice = goal.computeGoalModeNotice(false);
    expect(notice).toContain("目标已达预算");
  });

  it("computeGoalModeNotice: pursuing goal → '继续推进' 文案", () => {
    const deps = makeMockDeps({
      goal: {
        condition: "ship",
        status: "pursuing",
        turns: 2,
        maxTurns: 5,
        tokensUsed: 100,
        maxTokens: 1000,
        startedAt: 0,
      },
    });
    const goal = new GoalController(deps);
    const notice = goal.computeGoalModeNotice(false);
    expect(notice).toContain("继续推进");
    expect(notice).toContain("ship");
    expect(notice).toContain("2/5");
  });

  it("clearGoalState(silent=true) 清空 goal 不 emit notice", () => {
    const deps = makeMockDeps({
      goal: {
        condition: "ship",
        status: "pursuing",
        turns: 0,
        maxTurns: 5,
        tokensUsed: 0,
        maxTokens: 1000,
        startedAt: 0,
      },
    });
    const goal = new GoalController(deps);
    goal.clearGoalState("cleared", { silent: true });
    expect(deps.setGoalState).toHaveBeenCalledWith(null);
    expect(deps.emitModeNotice).not.toHaveBeenCalled();
  });

  it("clearGoalState(silent=false) 清空 goal 并 emit notice", () => {
    const deps = makeMockDeps({
      goal: {
        condition: "ship",
        status: "pursuing",
        turns: 0,
        maxTurns: 5,
        tokensUsed: 0,
        maxTokens: 1000,
        startedAt: 0,
      },
    });
    const goal = new GoalController(deps);
    goal.clearGoalState("cleared");
    expect(deps.setGoalState).toHaveBeenCalledWith(null);
    expect(deps.emitModeNotice).toHaveBeenCalled();
    const [text] = deps.emitModeNotice.mock.calls[0] as [string];
    expect(text).toContain("目标已清除");
    expect(text).toContain("ship");
  });

  it("setGoal 空条件返回 error", async () => {
    const deps = makeMockDeps();
    const goal = new GoalController(deps);
    const result = await goal.setGoal("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("不能为空");
    }
  });

  it("setGoal 过长条件返回 error", async () => {
    const deps = makeMockDeps();
    const goal = new GoalController(deps);
    const result = await goal.setGoal("a".repeat(4001));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("过长");
    }
  });

  it("setGoal 正常条件: 写入状态 + setAgentMode(goal) + emit", async () => {
    const deps = makeMockDeps();
    const goal = new GoalController(deps);
    const result = await goal.setGoal("ship the feature");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.goal?.condition).toBe("ship the feature");
      expect(result.goal?.status).toBe("pursuing");
    }
    expect(deps.setAgentMode).toHaveBeenCalledWith("goal");
    expect(deps.emitSessionMode).toHaveBeenCalled();
    expect(deps.emitGoal).toHaveBeenCalled();
  });

  it("pauseGoal 无 goal → ok:false", async () => {
    const deps = makeMockDeps({ goal: null });
    const goal = new GoalController(deps);
    const result = await goal.pauseGoal();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("无活跃目标");
    }
  });

  it("pauseGoal paused goal → idempotent ok:true", async () => {
    const deps = makeMockDeps({
      goal: {
        condition: "x",
        status: "paused",
        turns: 0,
        maxTurns: 5,
        tokensUsed: 0,
        maxTokens: 1000,
        startedAt: 0,
      },
    });
    const goal = new GoalController(deps);
    const result = await goal.pauseGoal();
    expect(result.ok).toBe(true);
  });

  it("pauseGoal pursuing → 状态改 paused + emit", async () => {
    const deps = makeMockDeps({
      goal: {
        condition: "x",
        status: "pursuing",
        turns: 0,
        maxTurns: 5,
        tokensUsed: 0,
        maxTokens: 1000,
        startedAt: 0,
      },
    });
    const goal = new GoalController(deps);
    const result = await goal.pauseGoal();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.goal?.status).toBe("paused");
    }
    expect(deps.emitGoal).toHaveBeenCalled();
  });

  it("clearGoal 有 goal → setAgentMode(agent) + emit", async () => {
    const deps = makeMockDeps({
      goal: {
        condition: "x",
        status: "pursuing",
        turns: 0,
        maxTurns: 5,
        tokensUsed: 0,
        maxTokens: 1000,
        startedAt: 0,
      },
      agentMode: "goal",
    });
    const goal = new GoalController(deps);
    const result = await goal.clearGoal();
    expect(result.ok).toBe(true);
    expect(deps.setAgentMode).toHaveBeenCalledWith("agent");
  });

  it("clearGoal 无 goal → 仍调 emit 但不报错", async () => {
    const deps = makeMockDeps({ goal: null });
    const goal = new GoalController(deps);
    const result = await goal.clearGoal();
    expect(result.ok).toBe(true);
    expect(deps.emitModeNotice).toHaveBeenCalledWith("当前无活跃目标");
  });

  it("rollbackGoalAfterRetract 无 goal → bump generation, no emit", () => {
    const deps = makeMockDeps({ goal: null });
    const goal = new GoalController(deps);
    goal.rollbackGoalAfterRetract(["u1"]);
    expect(deps.bumpGoalGeneration).toHaveBeenCalled();
    expect(deps.emitGoal).not.toHaveBeenCalled();
  });

  it("rollbackGoalAfterRetract 有 goal 且 id 匹配 → 过滤 ledger + emit", () => {
    const deps = makeMockDeps({
      goal: {
        condition: "x",
        status: "pursuing",
        turns: 1,
        maxTurns: 5,
        tokensUsed: 100,
        maxTokens: 1000,
        startedAt: 0,
      },
    });
    deps.ledger.push({ userEntryId: "u1", tokens: 100, turnIncremented: true });
    deps.ledger.push({ userEntryId: "u2", tokens: 50, turnIncremented: false });
    const goal = new GoalController(deps);
    goal.rollbackGoalAfterRetract(["u2"]);
    // u2 被过滤,ledger 只剩 u1
    expect(deps.ledger.length).toBe(1);
    expect(deps.ledger[0].userEntryId).toBe("u1");
  });
});
