/**
 * SessionModeController — 4 case mode 互锁 + plan/goal/ask 业务编排.
 *
 * 主题 B (issue #63) 收口: 1019 → < 714 行, 4 case 各自可独立单测.
 * - C-107: 4 case commit 模板合一 (applyModeChange + 4 个 case config lambda)
 * - C-404: 拆 AskController / PlanController / GoalController 三个子编排器,
 *   SessionModeController 保留状态 + 互锁 + 共用 helpers, 子编排器只 import
 *   自己关心的 deps (host + getPlanPath/getGoalState 等), 测试可独立 mock.
 *
 * 状态归属:
 * - `agentMode` / `savedTools` — SessionModeController (4 case 共享)
 * - `planPath` — SessionModeController (emitSessionMode / getInfo 共享),
 *   PlanController 通过 deps.getPlanPath/setPlanPath 读写
 * - `goal` / `goalContinueInFlight` / `goalEvalGeneration` / `goalTurnLedger`
 *   — SessionModeController 持有, GoalController 通过 deps 读写
 */
import type { AgentSession, DefaultResourceLoader, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  AgentSessionMode,
  GoalInfo,
  GoalResult,
  GoalStatus,
  PlanContentResult,
  PlanMutateResult,
  PromptResult,
  SessionModeInfo,
  SessionModeResult,
} from "../../../shared/ipc";
import { isRestorableGoalStatus } from "../../../shared/ipc";
import { DEFAULT_SESSION_TYPE, type SessionType } from "../../../shared/session-type";
import {
  createSessionTypePolicy,
  type SessionTypePolicy,
} from "../session-type-policy";
import { getCachedPrefs } from "../prefs";
import {
  computeModeToolsForType,
  isReadonlySessionMode,
  withoutWritePlan,
} from "./plan-tools";
import { AskController, type AskControllerDeps } from "./ask-controller";
import { PlanController, type PlanControllerDeps } from "./plan-controller";
import { GoalController, type GoalControllerDeps, type GoalTurnLedgerEntry } from "./goal-controller";
import { clearPlanJournal, savePlanJournal } from "./plan-journal";
import {
  buildAskModeSystemAppend,
  buildCompletionDisciplineAppend,
  buildGameDesignLayoutGuide,
  buildGoalModeSystemAppend,
  buildPlanModeSystemAppend,
  buildToolEconomyAppend,
} from "../../../shared/mode-prompt";
import { dbgLog } from "../../../shared/debug-log";
import type { SessionModeHost } from "../host-interfaces";

/**
 * 4 case commit 模板 (C-107) 的配置 shape. AskController / PlanController
 * 的 buildCaseConfig 产生此 shape; SessionModeController.applyModeChange 执行.
 *
 * - `pre`  — 切换前状态改写 (e.g. clearGoalState / captureSavedTools).
 * - `tools` — 新 active tool 列表;undefined = 保持当前 Pi session 的 active tools.
 * - `notice` — 用户看到的提示 (函数式, 让 planPath-aware 文案可以 lazy 求值).
 * - `rollback` — 切换后校验, 失败时返回 { ok: false, ... } 阻止进入新 mode.
 */
type ModeCaseConfig = {
  pre?: () => void;
  tools: string[] | undefined;
  notice: () => string;
  rollback?: () => SessionModeResult | null;
};

export class SessionModeController {
  // ===== Shared state (4 case 互锁基础) =====
  private agentMode: AgentSessionMode = "agent";
  private savedTools: string[] | null = null;
  // Plan state (PlanController 通过 deps 访问)
  private planPath: string | null = null;
  // Goal state (GoalController 通过 deps 访问)
  private goal: GoalInfo | null = null;
  private goalContinueInFlight = false;
  /** Bumped on retract/pause/clear to invalidate in-flight eval + deferred continue. */
  private goalEvalGeneration = 0;
  private goalTurnLedger: GoalTurnLedgerEntry[] = [];

  // ===== Sub-controllers (主题 B-2 C-404) =====
  private readonly askCtrl: AskController;
  private readonly planCtrl: PlanController;
  private readonly goalCtrl: GoalController;

  constructor(private readonly host: () => SessionModeHost) {
    this.askCtrl = new AskController(this as unknown as AskControllerDeps);
    this.planCtrl = new PlanController(this as unknown as PlanControllerDeps);
    this.goalCtrl = new GoalController(this as unknown as GoalControllerDeps);
  }

  // ===== Public read API =====

  getMode(): AgentSessionMode {
    return this.agentMode;
  }

  getPlanPath(): string | null {
    return this.planPath;
  }

  /** Resolve the active session type from the host bundle. Defaults to code. */
  getSessionType(): SessionType {
    return this.host().getBundle()?.sessionType ?? DEFAULT_SESSION_TYPE;
  }

  /** Resolve the active session type policy. Defaults to CodePolicy. */
  getSessionTypePolicy(): SessionTypePolicy {
    return createSessionTypePolicy(this.getSessionType());
  }

  getInfo(): SessionModeInfo {
    const bundle = this.host().getBundle();
    return {
      mode: this.agentMode,
      planPath: this.planPath,
      tools: bundle ? bundle.session.getActiveToolNames() : [],
    };
  }

  getGoal(): GoalInfo | null {
    return this.goal;
  }

  // ===== Public mutate API (delegates to sub-controllers) =====

  setPlanPath(path: string | null): void {
    this.planPath = path;
    this.persistPlanJournal();
  }

  onPlanWritten(path: string): void {
    this.planCtrl.onPlanWritten(path);
  }

  buildPlan(): Promise<PromptResult> {
    return this.planCtrl.buildPlan();
  }

  getPlanContent(): PlanContentResult {
    return this.planCtrl.getPlanContent();
  }

  savePlanContent(markdown: string): PlanMutateResult {
    return this.planCtrl.savePlanContent(markdown);
  }

  savePlanToWorkspace(): PlanMutateResult {
    return this.planCtrl.savePlanToWorkspace();
  }

  clearPlan(): PlanMutateResult {
    return this.planCtrl.clearPlan();
  }

  setGoal(condition: string): Promise<GoalResult> {
    return this.goalCtrl.setGoal(condition);
  }

  pauseGoal(): Promise<GoalResult> {
    return this.goalCtrl.pauseGoal();
  }

  resumeGoal(): Promise<GoalResult> {
    return this.goalCtrl.resumeGoal();
  }

  clearGoal(): Promise<GoalResult> {
    return this.goalCtrl.clearGoal();
  }

  onAgentSettled(): Promise<void> {
    return this.goalCtrl.onAgentSettled();
  }

  rollbackGoalAfterRetract(abandonedUserEntryIds: readonly string[]): void {
    this.goalCtrl.rollbackGoalAfterRetract(abandonedUserEntryIds);
  }

  restorePlanFromJournal(): void {
    this.planCtrl.restorePlanFromJournal();
  }

  restoreGoalFromJournal(): void {
    this.goalCtrl.restoreGoalFromJournal();
  }

  // ===== Common helpers used by all sub-controllers (deps 暴露) =====

  getAgentMode(): AgentSessionMode {
    return this.agentMode;
  }

  setAgentMode(mode: AgentSessionMode): void {
    this.agentMode = mode;
  }

  // 4 case commit — Agent case config + shared apply
  async setMode(mode: AgentSessionMode): Promise<SessionModeResult> {
    // 白名单校验：拒绝非合法 mode 字符串（"agent" | "ask" | "plan" | "goal"）。
    if (mode !== "agent" && mode !== "ask" && mode !== "plan" && mode !== "goal") {
      return { ok: false, error: `非法 mode：${String(mode)}` };
    }
    // DEBUG(thinking-switch #30): 跟踪 setMode 入口,排查 模式切换后 thinking 被静默重置
    dbgLog("mode", "setMode in", { from: this.agentMode, to: mode });
    const bundle = this.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    if (bundle.session.isStreaming) {
      return { ok: false, error: "请等待当前回合结束后再切换模式" };
    }
    if (mode === this.agentMode) {
      return {
        ok: true,
        info: this.getInfo(),
        needGoalCondition:
          mode === "goal" && !isRestorableGoalStatus(this.goal?.status),
      };
    }

    // 4 case commit 模板 (C-107): 3 case (ask/plan/agent) 走 applyModeChange,
    // goal case 走 GoalController.applyGoalModeChange.
    switch (mode) {
      case "ask":
        return this.applyModeChange("ask", this.askCtrl.buildCaseConfig());
      case "plan":
        return this.applyModeChange("plan", this.planCtrl.buildCaseConfig());
      case "agent": {
        const wasReadonly = isReadonlySessionMode(this.agentMode);
        return this.applyModeChange("agent", this.buildAgentCaseConfig(wasReadonly));
      }
      case "goal":
        return this.goalCtrl.applyGoalModeChange();
    }
  }

  /** Agent case config lambda (无独立子 controller,留在主 controller). */
  private buildAgentCaseConfig(wasReadonly: boolean): ModeCaseConfig {
    return {
      pre: () => {
        this.clearGoalState("cleared", { silent: true });
        if (!wasReadonly) this.savedTools = null;
      },
      tools: wasReadonly ? this.takeRestoredTools() : undefined,
      notice: () => this.agentModeNotice(),
    };
  }

  /** Shared apply path for ask/plan/agent (C-107 模板). */
  private applyModeChange(
    mode: Exclude<AgentSessionMode, "goal">,
    c: ModeCaseConfig,
  ): SessionModeResult {
    this.agentMode = mode;
    if (c.pre) c.pre();
    this.refreshSystemPrompt(c.tools);
    if (c.rollback) {
      const result = c.rollback();
      if (result) return result;
    }
    this.emitSessionMode();
    this.emitGoal();
    this.emitModeNotice(c.notice());
    return { ok: true, info: this.getInfo() };
  }

  /** Agent 模式 notice (planPath-aware). */
  private agentModeNotice(): string {
    return this.planPath
      ? "已切换到 Agent 模式。右栏「计划」仍可查看或执行当前计划。"
      : "已切换到 Agent 模式。";
  }

  // ===== system prompt / tool 切换 (compose 串起 mode 状态) =====

  composeModeAppend(base: string[]): string[] {
    const out = [...base];
    // Type-level append FIRST (策划会话下, 任何 mode 都要看到写约束说明).
    const typeAppend = this.getSessionTypePolicy().systemAppend();
    if (typeAppend) {
      out.push(typeAppend);
    }
    // GDD layout guide (策划会话 only). Anchors the standard 9-section
    // GDD skeleton so "整理 / 写入 设计文档" 任务不再产出 summary/audit/
    // integration-plan 这类自由发挥的副产物 (#40 follow-up).
    if (this.getSessionType() === "design") {
      out.push(buildGameDesignLayoutGuide());
    }
    // Tool economy — read with offset/limit, edit over write, batch
    // independent reads. Universal across session types.
    out.push(buildToolEconomyAppend());
    // Completion discipline — when to stop. Universal across all modes.
    out.push(buildCompletionDisciplineAppend());
    if (this.agentMode === "ask") {
      out.push(buildAskModeSystemAppend());
    } else if (this.agentMode === "plan") {
      out.push(buildPlanModeSystemAppend());
    } else if (
      this.agentMode === "goal" &&
      this.goal?.status === "pursuing" &&
      this.goal.condition
    ) {
      out.push(buildGoalModeSystemAppend(this.goal.condition));
    }
    return out;
  }

  /**
   * Patch the loader's cached append list in place, then rebuild the system
   * prompt via setActiveToolsByName (Pi re-reads getAppendSystemPrompt()).
   * Tool switching always runs even if the loader is briefly unavailable.
   */
  refreshSystemPrompt(toolNames?: string[]): void {
    const bundle = this.host().getBundle();
    if (!bundle) return;
    const resourceLoader = this.host().getResourceLoader();
    if (resourceLoader) {
      const cached = resourceLoader.getAppendSystemPrompt();
      const next = this.composeModeAppend(this.host().getBaseAppendPrompt());
      cached.splice(0, cached.length, ...next);
    }
    bundle.session.setActiveToolsByName(
      toolNames ?? bundle.session.getActiveToolNames(),
    );
  }

  // ===== session-level reset / 资源重载 =====

  reset(opts?: { emit?: boolean }): void {
    this.agentMode = "agent";
    this.savedTools = null;
    this.planPath = null;
    this.goal = null;
    this.goalContinueInFlight = false;
    this.goalEvalGeneration += 1;
    this.goalTurnLedger = [];
    // Do not clear on-disk journal here — resumeSession restores it after bind.
    if (opts?.emit !== false && this.host().getBundle()) {
      this.emitSessionMode();
      this.emitGoal();
    }
  }

  applyReadonlyModeTools(
    tools: string[],
  ): { ok: true } | { ok: false; error: string } {
    this.savedTools = [...tools];
    const mode = this.agentMode === "ask" ? "ask" : "plan";
    const modeTools = computeModeToolsForType(this.getSessionTypePolicy(), mode, tools);
    const label = mode === "ask" ? "调研" : "Plan";
    try {
      this.refreshSystemPrompt(modeTools);
      this.emitSessionMode();
      this.host().emitReplaceableNotice(
        "tools",
        `已更新工具偏好；${label} 模式仍使用只读工具集，退出模式后恢复。`,
        "warn",
      );
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.host().emitReplaceableNotice(
        "tools",
        `应用工具失败：${error}`,
        "error",
      );
      return { ok: false, error };
    }
  }

  refreshAfterResourceReload(): void {
    const prefs = getCachedPrefs();
    const policy = this.getSessionTypePolicy();
    if (this.agentMode === "ask") {
      this.refreshSystemPrompt(computeModeToolsForType(policy, "ask", prefs.tools));
    } else if (this.agentMode === "plan") {
      this.refreshSystemPrompt(computeModeToolsForType(policy, "plan", prefs.tools));
    } else if (policy.type === "design") {
      // 设计会话: agent mode → 仍用 design 工具基线 (write/edit 已被 guard 兜底).
      this.refreshSystemPrompt(computeModeToolsForType(policy, "agent", prefs.tools));
    } else {
      this.refreshSystemPrompt(prefs.tools);
    }
    this.emitSessionMode();
  }

  // ===== emit helpers (sub-controllers 经 deps 调用) =====

  emitSessionMode(): void {
    const bundle = this.host().getBundle();
    const tools = bundle ? bundle.session.getActiveToolNames() : [];
    this.host().emit({
      type: "session_mode",
      mode: this.agentMode,
      planPath: this.planPath,
      tools,
    });
  }

  emitGoal(): void {
    this.host().emit({ type: "goal_update", goal: this.goal });
  }

  private emitModeNotice(
    text: string,
    level: "info" | "warn" | "error" = "info",
  ): void {
    this.host().emitReplaceableNotice("session_mode", text, level);
  }

  // ===== Deps 暴露给子 controller (composition root) =====

  /** Capture prefs-era tools before entering ask/plan; keep if already readonly. */
  captureSavedToolsFromSession(): void {
    if (this.savedTools != null && isReadonlySessionMode(this.agentMode)) {
      return;
    }
    const bundle = this.host().getBundle();
    if (!bundle) return;
    const prefs = getCachedPrefs();
    this.savedTools = withoutWritePlan(bundle.session.getActiveToolNames());
    if (this.savedTools.length === 0) {
      this.savedTools = [...prefs.tools];
    }
  }

  /** Restore tools saved before ask/plan; clear savedTools. */
  takeRestoredTools(): string[] {
    const tools = this.savedTools ?? getCachedPrefs().tools;
    this.savedTools = null;
    return tools;
  }

  sessionPath(): string | null {
    const bundle = this.host().getBundle();
    const path = bundle?.sessionPath;
    return typeof path === "string" && path.trim() ? path : null;
  }

  /** 委托给 GoalController.clearGoalState (子 controller 自己也调). */
  clearGoalState(
    status: Extract<GoalStatus, "cleared" | "achieved">,
    opts?: { silent?: boolean; reason?: string },
  ): void {
    this.goalCtrl.clearGoalState(status, opts);
  }

  // Goal state bridge (GoalController 自身也用)
  getGoalState(): GoalInfo | null {
    return this.goal;
  }
  setGoalState(goal: GoalInfo | null): void {
    this.goal = goal;
  }
  getContinueInFlight(): boolean {
    return this.goalContinueInFlight;
  }
  setContinueInFlight(v: boolean): void {
    this.goalContinueInFlight = v;
  }
  getGoalGeneration(): number {
    return this.goalEvalGeneration;
  }
  bumpGoalGeneration(): void {
    this.goalEvalGeneration += 1;
  }
  getGoalTurnLedger(): GoalTurnLedgerEntry[] {
    return this.goalTurnLedger;
  }
  setGoalTurnLedger(ledger: GoalTurnLedgerEntry[]): void {
    this.goalTurnLedger = ledger;
  }

  /** Persist the current plan reference (or clear it) for this session. */
  private persistPlanJournal(): void {
    const path = this.sessionPath();
    if (!path) return;
    if (this.planPath) {
      savePlanJournal(path, this.planPath);
    } else {
      clearPlanJournal(path);
    }
  }
}
