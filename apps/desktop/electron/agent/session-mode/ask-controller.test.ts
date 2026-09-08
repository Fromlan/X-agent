/**
 * Vitest 套件 —— AskController (主题 B-2 / C-404, issue #63).
 *
 * 验证 4 case 中的 ask case 可独立单测 (mock AskControllerDeps, 不需要造整个
 * SessionModeController). 锁住 ask 进入路径 + notice 文案两条不变量.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AskController, type AskControllerDeps } from "./ask-controller";
import { CodePolicy, type SessionTypePolicy } from "../session-type-policy";
import { setAgentDirOverrideForTests } from "../prefs";
import type { GoalStatus } from "../../../shared/ipc";

interface MockDeps extends AskControllerDeps {
  clearGoalState: ReturnType<typeof vi.fn>;
  captureSavedToolsFromSession: ReturnType<typeof vi.fn>;
  getPlanPath: ReturnType<typeof vi.fn>;
  getSessionTypePolicy: ReturnType<typeof vi.fn>;
}

function makeMockDeps(): MockDeps {
  return {
    getPlanPath: vi.fn(() => null),
    clearGoalState: vi.fn(),
    captureSavedToolsFromSession: vi.fn(),
    getSessionTypePolicy: vi.fn(
      (): SessionTypePolicy => new CodePolicy(),
    ),
  };
}

describe("AskController — ask case (C-404)", () => {
  let setupDir: string;

  beforeEach(() => {
    setupDir = `D:/UGit/.scratch/test-ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAgentDirOverrideForTests(setupDir);
  });

  it("buildCaseConfig().pre 会清空 goal (silent) 并 capture 当前工具集", () => {
    const deps = makeMockDeps();
    const ask = new AskController(deps);
    const c = ask.buildCaseConfig();
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

  it("buildCaseConfig().tools 返回 read-only 工具集 (含 read/grep/find/ls)", () => {
    const deps = makeMockDeps();
    const ask = new AskController(deps);
    const c = ask.buildCaseConfig();
    expect(c.tools).toBeDefined();
    const tools = c.tools as string[];
    expect(tools).toContain("read");
    expect(tools).toContain("grep");
    expect(tools).toContain("find");
    expect(tools).toContain("ls");
    // ask 模式不应该包含 write/edit
    expect(tools).not.toContain("write");
    expect(tools).not.toContain("edit");
    // 也不应该有 write_plan
    expect(tools).not.toContain("write_plan");
  });

  it("buildCaseConfig().notice 无 planPath 时返回 '只读问答' 提示", () => {
    const deps = makeMockDeps();
    deps.getPlanPath.mockReturnValue(null);
    const ask = new AskController(deps);
    const c = ask.buildCaseConfig();
    const notice = c.notice();
    expect(notice).toContain("调研模式");
    expect(notice).toContain("只读");
    expect(notice).not.toContain("仍保留");
  });

  it("buildCaseConfig().notice 有 planPath 时提示保留计划", () => {
    const deps = makeMockDeps();
    deps.getPlanPath.mockReturnValue("D:/proj/.pi/plans/x.md");
    const ask = new AskController(deps);
    const c = ask.buildCaseConfig();
    const notice = c.notice();
    expect(notice).toContain("调研模式");
    expect(notice).toContain("D:/proj/.pi/plans/x.md");
  });

  it("buildCaseConfig() 无 rollback (ask 不需要 validate 写工具)", () => {
    const deps = makeMockDeps();
    const ask = new AskController(deps);
    const c = ask.buildCaseConfig();
    expect(c.rollback).toBeUndefined();
  });
});
