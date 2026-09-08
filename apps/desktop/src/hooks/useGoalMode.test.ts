/**
 * Vitest 套件 —— src/hooks/useGoalMode (issue #61 主题 F C-202).
 *
 * 锁住 3 组不变量:
 * 1. `parseGoalCommand` 纯函数 8 case
 * 2. `MODE_CYCLE` 顺序
 * 3. `createGoalModeDispatcher` 行为契约 —— 通过纯 dispatcher 直接调,
 *    不挂 React (vitest 走 node env, 无 DOM, 避免 testing-library 依赖)。
 *
 * 注: `useGoalMode` hook 本身只是 `createGoalModeDispatcher` 的 useMemo
 * 包装, 行为已 100% 锁定。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MODE_CYCLE,
  createGoalModeDispatcher,
  parseGoalCommand,
} from "./useGoalMode";
import type { AgentSessionMode, GoalInfo } from "@shared/ipc";

// ─── parseGoalCommand (纯函数) ─────────────────────────────────────────

describe("parseGoalCommand —— 纯函数解析", () => {
  it("/goal → show", () => {
    expect(parseGoalCommand("/goal")).toEqual({ kind: "show" });
  });

  it("/goal (带尾随空格) → show", () => {
    expect(parseGoalCommand("/goal ")).toEqual({ kind: "show" });
    expect(parseGoalCommand("/goal   ")).toEqual({ kind: "show" });
  });

  it("/goal clear → clear", () => {
    expect(parseGoalCommand("/goal clear")).toEqual({ kind: "clear" });
    expect(parseGoalCommand("/goal CLEAR")).toEqual({ kind: "clear" });
  });

  it("/goal pause → pause", () => {
    expect(parseGoalCommand("/goal pause")).toEqual({ kind: "pause" });
  });

  it("/goal resume / /goal continue → resume (二者等价)", () => {
    expect(parseGoalCommand("/goal resume")).toEqual({ kind: "resume" });
    expect(parseGoalCommand("/goal continue")).toEqual({ kind: "resume" });
    expect(parseGoalCommand("/goal RESUME")).toEqual({ kind: "resume" });
  });

  it("/goal <条件> → set, condition 去除两端空白", () => {
    expect(parseGoalCommand("/goal 写完登录流程")).toEqual({
      kind: "set",
      condition: "写完登录流程",
    });
    expect(parseGoalCommand("/goal  Ship the splash  ")).toEqual({
      kind: "set",
      condition: "Ship the splash",
    });
  });

  it("非 goal 命令 → null (不消费输入)", () => {
    expect(parseGoalCommand("hello world")).toBeNull();
    expect(parseGoalCommand("/goals set xxx")).toBeNull();
  });

  it("/goal 词边界 clear/pause/... 后跟 extra 仍识别为子命令", () => {
    expect(parseGoalCommand("/goal clear-thing")).toEqual({ kind: "clear" });
    expect(parseGoalCommand("/goal clearing")).toEqual({
      kind: "set",
      condition: "clearing",
    });
  });

  it("空 / 纯空白文本 → null", () => {
    expect(parseGoalCommand("")).toBeNull();
    expect(parseGoalCommand("   ")).toBeNull();
  });
});

// ─── MODE_CYCLE (常量) ────────────────────────────────────────────────

describe("MODE_CYCLE —— 顺序契约", () => {
  it("agent → ask → plan → goal → agent", () => {
    expect(MODE_CYCLE).toEqual(["agent", "ask", "plan", "goal"]);
  });
});

// ─── createGoalModeDispatcher (纯工厂, hook 行为由它决定) ─────────────

type PlanMock = {
  getGoal: ReturnType<typeof vi.fn>;
  setGoal: ReturnType<typeof vi.fn>;
  clearGoal: ReturnType<typeof vi.fn>;
  pauseGoal: ReturnType<typeof vi.fn>;
  resumeGoal: ReturnType<typeof vi.fn>;
  setMode: ReturnType<typeof vi.fn>;
};

function installPlanMock(): PlanMock {
  const planMock: PlanMock = {
    getGoal: vi.fn(),
    setGoal: vi.fn(),
    clearGoal: vi.fn(),
    pauseGoal: vi.fn(),
    resumeGoal: vi.fn(),
    setMode: vi.fn(),
  };
  // 默认 IPC 成功
  planMock.getGoal.mockResolvedValue(null);
  planMock.setGoal.mockResolvedValue({ ok: true, goal: null });
  planMock.clearGoal.mockResolvedValue({ ok: true });
  planMock.pauseGoal.mockResolvedValue({ ok: true, goal: null });
  planMock.resumeGoal.mockResolvedValue({ ok: true, goal: null });
  planMock.setMode.mockResolvedValue({
    ok: true,
    info: { mode: "agent", planPath: null, needGoalCondition: false },
  });

  // vitest 用 node env, 没有 window, 注入到 globalThis.window
  (globalThis as unknown as { window: { xAgent: { plan: PlanMock } } }).window =
    { xAgent: { plan: planMock } };
  return planMock;
}

function setupSetters() {
  const setGoal = vi.fn();
  const setSessionMode = vi.fn();
  const setPlanPath = vi.fn();
  const onClearGoalDraft = vi.fn();
  const setFollowNonce = vi.fn();
  const setError = vi.fn();
  return {
    setGoal,
    setSessionMode,
    setPlanPath,
    onClearGoalDraft,
    setFollowNonce,
    setError,
  };
}

describe("createGoalModeDispatcher —— 行为契约 (useGoalMode 通过它实现)", () => {
  let planMock: PlanMock;
  beforeEach(() => {
    planMock = installPlanMock();
  });

  it("handleGoalCommand: 非 /goal 命令 → false (不消费)", async () => {
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "agent",
    });
    const consumed = await d.handleGoalCommand("hello world");
    expect(consumed).toBe(false);
    expect(planMock.getGoal).not.toHaveBeenCalled();
    expect(planMock.clearGoal).not.toHaveBeenCalled();
  });

  it("handleGoalCommand: /goal → 走 getGoal + setGoal (show)", async () => {
    const g: GoalInfo = {
      condition: "x",
      status: "pursuing",
      turns: 1,
      maxTurns: 20,
      tokensUsed: 100,
      maxTokens: 500000,
    };
    planMock.getGoal.mockResolvedValue(g);
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "agent",
    });
    const consumed = await d.handleGoalCommand("/goal");
    expect(consumed).toBe(true);
    expect(planMock.getGoal).toHaveBeenCalledTimes(1);
    expect(setters.setGoal).toHaveBeenCalledWith(g);
    expect(setters.setError).toHaveBeenCalledTimes(1);
  });

  it("handleGoalCommand: /goal clear → 走 clearGoal", async () => {
    // sessionMode 不是 "goal" 时 slash 走正常解析
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "agent",
    });
    const consumed = await d.handleGoalCommand("/goal clear");
    expect(consumed).toBe(true);
    expect(planMock.clearGoal).toHaveBeenCalledTimes(1);
    expect(setters.setGoal).toHaveBeenCalledWith(null);
    expect(setters.setSessionMode).toHaveBeenCalledWith("agent");
  });

  it("handleGoalCommand: /goal pause → 走 pauseGoal", async () => {
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "agent",
    });
    await d.handleGoalCommand("/goal pause");
    expect(planMock.pauseGoal).toHaveBeenCalledTimes(1);
  });

  it("handleGoalCommand: /goal resume / /goal continue → 走 resumeGoal + 切 goal mode", async () => {
    for (const cmd of ["/goal resume", "/goal continue"]) {
      planMock.resumeGoal.mockClear();
      const setters = setupSetters();
      const d = createGoalModeDispatcher({
        ...setters,
        goal: null,
        sessionMode: "agent",
      });
      await d.handleGoalCommand(cmd);
      expect(planMock.resumeGoal).toHaveBeenCalled();
      expect(setters.setSessionMode).toHaveBeenCalledWith("goal");
    }
  });

  it("handleGoalCommand: /goal <条件> → 走 setGoalCondition", async () => {
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "agent",
    });
    await d.handleGoalCommand("/goal  写完登录流程  ");
    expect(planMock.setGoal).toHaveBeenCalledWith("写完登录流程");
    expect(setters.setSessionMode).toHaveBeenCalledWith("goal");
  });

  it("handleGoalCommand: goal 模式 + 目标未设条件 → 整条 text 作为 condition", async () => {
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "goal",
    });
    await d.handleGoalCommand("让所有单元测试通过");
    expect(planMock.setGoal).toHaveBeenCalledWith("让所有单元测试通过");
    expect(setters.setSessionMode).toHaveBeenCalledWith("goal");
  });

  it("handleGoalCommand: goal 模式 + 已有可恢复条件 → /goal clear 走 clearGoal 路径", async () => {
    const goal: GoalInfo = {
      condition: "x",
      status: "pursuing",
      turns: 1,
      maxTurns: 20,
      tokensUsed: 100,
      maxTokens: 500000,
    };
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal,
      sessionMode: "goal",
    });
    await d.handleGoalCommand("/goal clear");
    expect(planMock.clearGoal).toHaveBeenCalledTimes(1);
  });

  it("clearGoal: 失败时 setError, 不动 setGoal", async () => {
    planMock.clearGoal.mockResolvedValue({ ok: false, error: "boom" });
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "goal",
    });
    await d.clearGoal();
    expect(setters.setError).toHaveBeenCalledWith("boom");
    expect(setters.setGoal).not.toHaveBeenCalled();
  });

  it("clearGoal: 成功时清 goal + 切回 agent", async () => {
    planMock.clearGoal.mockResolvedValue({ ok: true });
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "goal",
    });
    await d.clearGoal();
    expect(setters.setGoal).toHaveBeenCalledWith(null);
    expect(setters.setSessionMode).toHaveBeenCalledWith("agent");
  });

  it("changeSessionMode: 切到 agent → 清 goal + 调 onClearGoalDraft", async () => {
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "goal",
    });
    await d.changeSessionMode("agent");
    expect(planMock.setMode).toHaveBeenCalledWith("agent");
    expect(setters.setGoal).toHaveBeenCalledWith(null);
    expect(setters.onClearGoalDraft).toHaveBeenCalled();
  });

  it("changeSessionMode: 切到 ask → 同上 (agent/ask/plan 都清 goal)", async () => {
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "goal",
    });
    await d.changeSessionMode("ask");
    expect(planMock.setMode).toHaveBeenCalledWith("ask");
    expect(setters.setGoal).toHaveBeenCalledWith(null);
  });

  it("changeSessionMode: 切到 goal + needGoalCondition → 清 /goal 草稿 + bump followNonce", async () => {
    planMock.setMode.mockResolvedValue({
      ok: true,
      info: { mode: "goal", planPath: null, tools: [] },
      needGoalCondition: true,
    });
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "agent",
    });
    await d.changeSessionMode("goal");
    expect(setters.onClearGoalDraft).toHaveBeenCalled();
    expect(setters.setFollowNonce).toHaveBeenCalled();
  });

  it("changeSessionMode: 失败时不调任何 setter (除 setError)", async () => {
    planMock.setMode.mockResolvedValue({ ok: false, error: "fail" });
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "agent",
    });
    await d.changeSessionMode("goal");
    expect(setters.setError).toHaveBeenCalledWith("fail");
    expect(setters.setGoal).not.toHaveBeenCalled();
    expect(setters.setSessionMode).not.toHaveBeenCalled();
  });

  it("cycleSessionMode: agent → ask", async () => {
    planMock.setMode.mockResolvedValue({
      ok: true,
      info: { mode: "ask", planPath: null, needGoalCondition: false },
    });
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "agent",
    });
    await d.cycleSessionMode();
    expect(planMock.setMode).toHaveBeenCalledWith("ask");
  });

  it("cycleSessionMode: goal → agent (环回)", async () => {
    planMock.setMode.mockResolvedValue({
      ok: true,
      info: { mode: "agent", planPath: null, needGoalCondition: false },
    });
    const setters = setupSetters();
    const d = createGoalModeDispatcher({
      ...setters,
      goal: null,
      sessionMode: "goal",
    });
    await d.cycleSessionMode();
    expect(planMock.setMode).toHaveBeenCalledWith("agent");
  });

  it("cycleSessionMode: 4 mode 全 cycle 一轮", async () => {
    let mode: AgentSessionMode = "agent";
    planMock.setMode.mockImplementation(
      async (m: AgentSessionMode) => ({
        ok: true,
        info: { mode: m, planPath: null, needGoalCondition: false },
      }),
    );
    const setters = setupSetters();
    for (let i = 0; i < 4; i++) {
      setters.setGoal.mockClear();
      setters.setSessionMode.mockClear();
      const d = createGoalModeDispatcher({
        ...setters,
        goal: null,
        sessionMode: mode,
      });
      await d.cycleSessionMode();
      // 调用 setMode 的 mode 应该是 cycle 后一位
      const expectedNext =
        MODE_CYCLE[(MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length];
      expect(planMock.setMode).toHaveBeenLastCalledWith(expectedNext);
      mode = expectedNext;
    }
  });
});
