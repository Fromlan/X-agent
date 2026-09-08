/**
 * Vitest 套件 —— PlanController (主题 B-2 / C-404, issue #63).
 *
 * 验证 4 case 中的 plan case 可独立单测 (mock PlanControllerDeps, 不需要
 * 造整个 SessionModeController). 锁住 plan case config + write_plan rollback
 * + plan 文档/业务两条不变量.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PlanController, type PlanControllerDeps } from "./plan-controller";
import { CodePolicy, type SessionTypePolicy } from "../session-type-policy";
import { setAgentDirOverrideForTests } from "../prefs";
import type { AgentSessionMode, GoalStatus, SessionModeInfo, SessionModeResult } from "../../../shared/ipc";
import type { SessionModeHost } from "../host-interfaces";
import type { PlanContentResult, PlanMutateResult, PromptResult } from "../../../shared/ipc";

interface MockDeps extends PlanControllerDeps {
  host: () => SessionModeHost;
  getPlanPath: ReturnType<typeof vi.fn>;
  setPlanPath: ReturnType<typeof vi.fn>;
  getAgentMode: ReturnType<typeof vi.fn>;
  setAgentMode: ReturnType<typeof vi.fn>;
  takeRestoredTools: ReturnType<typeof vi.fn>;
  captureSavedToolsFromSession: ReturnType<typeof vi.fn>;
  clearGoalState: ReturnType<typeof vi.fn>;
  getSessionTypePolicy: ReturnType<typeof vi.fn>;
  refreshSystemPrompt: ReturnType<typeof vi.fn>;
  emitSessionMode: ReturnType<typeof vi.fn>;
  emitModeNotice: ReturnType<typeof vi.fn>;
  getInfo: ReturnType<typeof vi.fn>;
  sessionPath: ReturnType<typeof vi.fn>;
}

function makeMockDeps(opts?: { activeTools?: string[]; planPath?: string | null }): MockDeps & { hostObject: SessionModeHost } {
  const activeTools = opts?.activeTools ?? ["read", "write", "write_plan", "bash"];
  const bundle = {
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
    sessionType: "code",
  };
  const hostObject: SessionModeHost = {
    getBundle: () => bundle,
    getResourceLoader: () => null,
    getBaseAppendPrompt: () => [],
    emit: vi.fn(),
    emitReplaceableNotice: vi.fn(),
    prompt: vi.fn(async () => ({ ok: true as const })),
    ensureRuntime: vi.fn(async () => ({}) as never),
    getLastTurnTokenTotal: () => 0,
    getActiveUserEntryId: () => null,
  };
  const deps: MockDeps & { hostObject: SessionModeHost } = {
    hostObject,
    host: () => hostObject,
    getPlanPath: vi.fn(() => opts?.planPath ?? null),
    setPlanPath: vi.fn(),
    getAgentMode: vi.fn((): AgentSessionMode => "agent"),
    setAgentMode: vi.fn(),
    takeRestoredTools: vi.fn(() => ["read", "bash"]),
    captureSavedToolsFromSession: vi.fn(),
    clearGoalState: vi.fn(),
    getSessionTypePolicy: vi.fn((): SessionTypePolicy => new CodePolicy()),
    refreshSystemPrompt: vi.fn(),
    emitSessionMode: vi.fn(),
    emitModeNotice: vi.fn(),
    getInfo: vi.fn((): SessionModeInfo => ({
      mode: "plan",
      planPath: opts?.planPath ?? null,
      tools: activeTools,
    })),
    sessionPath: vi.fn(() => "D:/proj/sess.jsonl"),
  };
  return deps;
}

describe("PlanController — plan case (C-404)", () => {
  let setupDir: string;

  beforeEach(() => {
    setupDir = `D:/UGit/.scratch/test-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAgentDirOverrideForTests(setupDir);
  });

  it("buildCaseConfig().pre 会清空 goal (silent) 并 capture 当前工具集", () => {
    const deps = makeMockDeps();
    const plan = new PlanController(deps);
    const c = plan.buildCaseConfig();
    expect(c.pre).toBeDefined();
    c.pre?.();
    expect(deps.clearGoalState).toHaveBeenCalledTimes(1);
    const [status, opts] = deps.clearGoalState.mock.calls[0] as [
      GoalStatus,
      { silent?: boolean } | undefined,
    ];
    expect(status).toBe("cleared");
    expect(opts?.silent).toBe(true);
    expect(deps.captureSavedToolsFromSession).toHaveBeenCalledTimes(1);
  });

  it("buildCaseConfig().tools 包含 write_plan", () => {
    const deps = makeMockDeps();
    const plan = new PlanController(deps);
    const c = plan.buildCaseConfig();
    expect(c.tools).toBeDefined();
    const tools = c.tools as string[];
    expect(tools).toContain("read");
    expect(tools).toContain("write_plan");
  });

  it("buildCaseConfig().notice 无 planPath 时返回 'Plan 模式' 提示", () => {
    const deps = makeMockDeps({ planPath: null });
    const plan = new PlanController(deps);
    const c = plan.buildCaseConfig();
    expect(c.notice()).toContain("Plan 模式");
  });

  it("buildCaseConfig().notice 有 planPath 时保留计划", () => {
    const deps = makeMockDeps({ planPath: "D:/proj/.pi/plans/x.md" });
    const plan = new PlanController(deps);
    const c = plan.buildCaseConfig();
    const notice = c.notice();
    expect(notice).toContain("Plan 模式");
    expect(notice).toContain("D:/proj/.pi/plans/x.md");
  });

  it("rollbackIfWritePlanMissing: write_plan 激活时返回 null (不阻塞 commit)", () => {
    const deps = makeMockDeps({ activeTools: ["read", "write_plan"] });
    const plan = new PlanController(deps);
    const result = plan.rollbackIfWritePlanMissing();
    expect(result).toBeNull();
    expect(deps.setAgentMode).not.toHaveBeenCalled();
  });

  it("rollbackIfWritePlanMissing: write_plan 缺失时回滚到 agent + emit error", () => {
    const deps = makeMockDeps({ activeTools: ["read", "write"] });
    const plan = new PlanController(deps);
    const result = plan.rollbackIfWritePlanMissing();
    expect(result).not.toBeNull();
    const r = result as SessionModeResult;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("write_plan");
    }
    expect(deps.setAgentMode).toHaveBeenCalledWith("agent");
    expect(deps.refreshSystemPrompt).toHaveBeenCalled();
    expect(deps.emitSessionMode).toHaveBeenCalled();
  });

  it("onPlanWritten 写 planPath, emit session_mode + notice", () => {
    const deps = makeMockDeps();
    const plan = new PlanController(deps);
    plan.onPlanWritten("D:/proj/.pi/plans/x.md");
    expect(deps.setPlanPath).toHaveBeenCalledWith("D:/proj/.pi/plans/x.md");
    expect(deps.emitSessionMode).toHaveBeenCalled();
    expect(deps.hostObject.emitReplaceableNotice).toHaveBeenCalled();
  });

  it("buildPlan 无 planPath 时返回 { ok: false, error }", async () => {
    const deps = makeMockDeps({ planPath: null });
    const plan = new PlanController(deps);
    const result = await plan.buildPlan();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("尚无计划文件");
    }
  });

  it("clearPlan: 无 planPath 时立即返回 ok", () => {
    const deps = makeMockDeps({ planPath: null });
    const plan = new PlanController(deps);
    const result: PlanMutateResult = plan.clearPlan();
    expect(result.ok).toBe(true);
    expect(deps.setPlanPath).not.toHaveBeenCalled();
  });

  it("clearPlan: 有 planPath 时清空并 emit", () => {
    const deps = makeMockDeps({ planPath: "D:/proj/.pi/plans/x.md" });
    const plan = new PlanController(deps);
    const result: PlanMutateResult = plan.clearPlan();
    expect(result.ok).toBe(true);
    expect(deps.setPlanPath).toHaveBeenCalledWith(null);
    expect(deps.emitSessionMode).toHaveBeenCalled();
  });
});
