import type { AgentSession, DefaultResourceLoader, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
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
  UiAgentEvent,
} from "../../../shared/ipc";
import {
  DEFAULT_GOAL_MAX_TOKENS,
  DEFAULT_GOAL_MAX_TURNS,
  isRestorableGoalStatus,
} from "../../../shared/ipc";
import { DEFAULT_SESSION_TYPE, type SessionType } from "../../../shared/session-type";
import { getCachedPrefs } from "../prefs";
import {
  buildImplementPrompt,
  classifyPlanLocation,
  computeAskModeTools,
  computeModeToolsForType,
  computePlanModeTools,
  isAllowedPlanPath,
  isReadonlySessionMode,
  readPlanMarkdown,
  savePlanToWorkspacePath,
  withoutWritePlan,
  writePlanMarkdown,
} from "./plan-tools";
import {
  buildGoalContinuePrompt,
  buildGoalEvalPrompt,
  buildGoalTranscript,
  parseGoalEvalResponse,
} from "./goal-evaluator";
import {
  clearGoalJournal,
  loadGoalJournal,
  saveGoalJournal,
} from "./goal-journal";
import {
  clearPlanJournal,
  loadPlanJournal,
  savePlanJournal,
} from "./plan-journal";
import {
  buildAskModeSystemAppend,
  buildDesignSessionTypeAppend,
  buildGoalModeSystemAppend,
  buildPlanModeSystemAppend,
} from "../../../shared/mode-prompt";
import { dbgLog } from "../../../shared/debug-log";

export type SessionModeHost = {
  getBundle(): {
    session: AgentSession;
    cwd: string;
    sessionPath?: string | null;
    sessionType?: SessionType;
  } | null;
  getResourceLoader(): DefaultResourceLoader | null;
  getBaseAppendPrompt(): string[];
  emit(event: UiAgentEvent): void;
  emitReplaceableNotice(
    replaceKey:
      | "session_mode"
      | "model"
      | "tools"
      | "resources"
      | "plan"
      | "goal_eval"
      | "session",
    text: string,
    level?: "info" | "warn" | "error",
  ): void;
  prompt(text: string): Promise<PromptResult>;
  ensureRuntime(): Promise<ModelRuntime>;
  /** Last assistant turn token total (0 if unknown). */
  getLastTurnTokenTotal(): number;
  /** Active user turn entry id (for goal budget ledger), if any. */
  getActiveUserEntryId(): string | null;
};

type GoalTurnLedgerEntry = {
  /** User entry that started the agent turn being evaluated. */
  userEntryId: string | null;
  tokens: number;
  turnIncremented: boolean;
};

function clampMaxTurns(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_GOAL_MAX_TURNS;
  return Math.min(200, Math.max(1, Math.floor(n)));
}

function clampMaxTokens(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return DEFAULT_GOAL_MAX_TOKENS;
  }
  return Math.min(10_000_000, Math.max(10_000, Math.floor(n)));
}

export class SessionModeController {
  private agentMode: AgentSessionMode = "agent";
  private savedTools: string[] | null = null;
  private planPath: string | null = null;
  private goal: GoalInfo | null = null;
  private goalContinueInFlight = false;
  /** Bumped on retract/pause/clear to invalidate in-flight eval + deferred continue. */
  private goalEvalGeneration = 0;
  private goalTurnLedger: GoalTurnLedgerEntry[] = [];

  constructor(private readonly host: () => SessionModeHost) {}

  getMode(): AgentSessionMode {
    return this.agentMode;
  }

  getPlanPath(): string | null {
    return this.planPath;
  }

  setPlanPath(path: string | null): void {
    this.planPath = path;
    this.persistPlanJournal();
  }

  /** write_plan callback: set path and notify UI. */
  onPlanWritten(path: string): void {
    this.planPath = path;
    this.persistPlanJournal();
    this.emitSessionMode();
    this.host().emitReplaceableNotice(
      "plan",
      `计划已写入：${path}。可在右栏「计划」中编辑，或点击「执行计划」。`,
    );
  }

  /** Resolve the active session type from the host bundle. Defaults to code. */
  getSessionType(): SessionType {
    return (
      this.host().getBundle()?.sessionType ?? DEFAULT_SESSION_TYPE
    );
  }

  composeModeAppend(base: string[]): string[] {
    const out = [...base];
    // Type-level append FIRST (策划会话下, 任何 mode 都要看到写约束说明).
    if (this.getSessionType() === "design") {
      out.push(buildDesignSessionTypeAppend());
    }
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

  /** Capture prefs-era tools before entering ask/plan; keep if already readonly. */
  private captureSavedToolsFromSession(): void {
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
  private takeRestoredTools(): string[] {
    const tools = this.savedTools ?? getCachedPrefs().tools;
    this.savedTools = null;
    return tools;
  }

  private sessionPath(): string | null {
    const bundle = this.host().getBundle();
    const path = bundle?.sessionPath;
    return typeof path === "string" && path.trim() ? path : null;
  }

  private persistGoalJournal(): void {
    const path = this.sessionPath();
    if (!path) return;
    if (this.goal && isRestorableGoalStatus(this.goal.status)) {
      saveGoalJournal(path, this.goal);
    } else {
      clearGoalJournal(path);
    }
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

  /**
   * Restore the plan reference from disk after resumeSession, so the right
   * panel Plan tab shows the plan again after an app restart.
   * Skips (and clears) when the file is gone or the path is outside the
   * allowed plan roots (home plans dir / cwd .pi/plans).
   */
  restorePlanFromJournal(): void {
    const path = this.sessionPath();
    if (!path) return;
    const stored = loadPlanJournal(path);
    if (!stored) return;
    const cwd = this.host().getBundle()?.cwd ?? null;
    if (!existsSync(stored) || !isAllowedPlanPath(stored, cwd)) {
      clearPlanJournal(path);
      return;
    }
    this.planPath = stored;
    this.emitSessionMode();
  }

  /**
   * Restore a pursuing/paused/budget_limited goal from disk after resumeSession.
   */
  restoreGoalFromJournal(): void {
    const path = this.sessionPath();
    if (!path) return;
    const stored = loadGoalJournal(path);
    if (!stored) return;
    this.goal = stored;
    this.goalTurnLedger = reconstructLedgerFromGoal(stored);
    this.goalEvalGeneration += 1;
    this.goalContinueInFlight = false;
    if (isRestorableGoalStatus(stored.status)) {
      this.agentMode = "goal";
      this.refreshSystemPrompt();
    }
    this.emitSessionMode();
    this.emitGoal();
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

  async setMode(mode: AgentSessionMode): Promise<SessionModeResult> {
    // 白名单校验：拒绝非合法 mode 字符串（"agent" | "ask" | "plan" | "goal"）。
    // 防止 renderer 端类型逃逸后端，写错持久化 / 误发 system prompt 补丁。
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

    if (mode === "ask") {
      this.clearGoalState("cleared", { silent: true });
      this.captureSavedToolsFromSession();
      const prefs = getCachedPrefs();
      this.agentMode = "ask";
      this.refreshSystemPrompt(
        computeModeToolsForType(this.getSessionType(), "ask", prefs.tools),
      );
      this.emitSessionMode();
      this.emitGoal();
      this.emitModeNotice(
        this.planPath
          ? `已进入调研模式（只读问答）。右栏「计划」仍保留：${this.planPath}`
          : "已进入调研模式（只读研究与问答，不改文件）。需要可执行方案请切 Plan。",
      );
      return { ok: true, info: this.getInfo() };
    }

    if (mode === "plan") {
      this.clearGoalState("cleared", { silent: true });
      this.captureSavedToolsFromSession();
      const prefs = getCachedPrefs();
      this.agentMode = "plan";
      this.refreshSystemPrompt(
        computeModeToolsForType(this.getSessionType(), "plan", prefs.tools),
      );
      const active = bundle.session.getActiveToolNames();
      if (!active.includes("write_plan")) {
        const restore = this.takeRestoredTools();
        this.agentMode = "agent";
        this.refreshSystemPrompt(restore);
        this.emitSessionMode();
        this.emitGoal();
        this.host().emitReplaceableNotice(
          "plan",
          "Plan 模式未能激活 write_plan（工具未注册）。请重开项目后再试。",
          "error",
        );
        return {
          ok: false,
          error: "write_plan 未激活，无法写出计划文件",
          info: this.getInfo(),
        };
      }
      this.emitSessionMode();
      this.emitGoal();
      this.emitModeNotice(
        this.planPath
          ? `已进入 Plan 模式。当前计划仍保留在右栏「计划」：${this.planPath}`
          : "已进入 Plan 模式（只读研究 + write_plan）。完成后在右栏审阅并「执行计划」。",
      );
      return { ok: true, info: this.getInfo() };
    }

    if (mode === "goal") {
      let tools: string[] | undefined;
      if (isReadonlySessionMode(this.agentMode)) {
        tools = this.takeRestoredTools();
      }
      this.agentMode = "goal";
      this.refreshSystemPrompt(tools);
      this.emitSessionMode();
      const needGoalCondition = !isRestorableGoalStatus(this.goal?.status);
      let notice = "已进入目标模式。请输入可验证的完成条件后发送。";
      if (!needGoalCondition && this.goal) {
        if (this.goal.status === "paused") {
          notice = `目标已暂停：「${this.goal.condition}」。可点「继续」恢复自动续轮。`;
        } else if (this.goal.status === "budget_limited") {
          notice = `目标已达预算（轮次 ${this.goal.turns}/${this.goal.maxTurns}，token ${this.goal.tokensUsed}/${this.goal.maxTokens}）。提高上限后可继续。`;
        } else {
          notice = `目标模式：继续推进「${this.goal.condition}」（${this.goal.turns}/${this.goal.maxTurns} 轮，${this.goal.tokensUsed}/${this.goal.maxTokens} tokens）`;
        }
      }
      this.emitModeNotice(notice);
      return {
        ok: true,
        info: this.getInfo(),
        needGoalCondition,
      };
    }

    let tools: string[] | undefined;
    if (isReadonlySessionMode(this.agentMode)) {
      tools = this.takeRestoredTools();
    } else {
      this.savedTools = null;
    }
    this.clearGoalState("cleared", { silent: true });
    this.agentMode = "agent";
    this.refreshSystemPrompt(tools);
    this.emitSessionMode();
    this.emitGoal();
    this.emitModeNotice(
      this.planPath
        ? "已切换到 Agent 模式。右栏「计划」仍可查看或执行当前计划。"
        : "已切换到 Agent 模式。",
    );
    return { ok: true, info: this.getInfo() };
  }

  private clearGoalState(
    status: Extract<GoalStatus, "cleared" | "achieved">,
    opts?: { silent?: boolean; reason?: string },
  ): void {
    if (!this.goal) {
      this.goalContinueInFlight = false;
      this.goalEvalGeneration += 1;
      this.goalTurnLedger = [];
      this.persistGoalJournal();
      return;
    }
    const snapshot = this.goal;
    snapshot.status = status;
    this.goal = null;
    this.goalContinueInFlight = false;
    this.goalEvalGeneration += 1;
    this.goalTurnLedger = [];
    this.persistGoalJournal();
    if (!opts?.silent) {
      this.emitModeNotice(
        status === "achieved"
          ? `目标已达成${opts?.reason ? `：${opts.reason}` : ""}`
          : `目标已清除：${snapshot.condition}`,
      );
    }
  }

  /**
   * After a successful retract, drop budget for abandoned user turns so
   * continue/regenerate does not double-count turns or tokens.
   */
  rollbackGoalAfterRetract(abandonedUserEntryIds: readonly string[]): void {
    if (!this.goal) {
      this.goalContinueInFlight = false;
      this.goalEvalGeneration += 1;
      return;
    }
    this.goalContinueInFlight = false;
    this.goalEvalGeneration += 1;

    const abandoned = new Set(
      abandonedUserEntryIds.filter((id) => typeof id === "string" && id),
    );
    if (abandoned.size === 0) {
      this.emitGoal();
      return;
    }

    const matched = this.goalTurnLedger.some(
      (e) => e.userEntryId && abandoned.has(e.userEntryId),
    );
    if (matched) {
      this.goalTurnLedger = this.goalTurnLedger.filter(
        (e) => !e.userEntryId || !abandoned.has(e.userEntryId),
      );
    } else {
      // Journal-restored synthetic ledger has no entry ids — pop N from end.
      const drop = Math.min(abandoned.size, this.goalTurnLedger.length);
      if (drop > 0) this.goalTurnLedger.splice(-drop, drop);
    }

    this.resyncGoalBudgetFromLedger();
    if (this.goal.status === "budget_limited") {
      this.goal.status = "paused";
      this.goal.lastReason = "撤回后预算已回滚，可点「继续」";
    }
    this.persistGoalJournal();
    this.emitGoal();
  }

  private resyncGoalBudgetFromLedger(): void {
    if (!this.goal) return;
    this.goal.turns = this.goalTurnLedger.filter((e) => e.turnIncremented)
      .length;
    this.goal.tokensUsed = this.goalTurnLedger.reduce(
      (sum, e) => sum + e.tokens,
      0,
    );
  }

  async buildPlan(): Promise<PromptResult> {
    const bundle = this.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    if (!this.planPath) {
      return {
        ok: false,
        error: "尚无计划文件。请先在 Plan 模式下让 Agent 调用 write_plan。",
      };
    }
    if (bundle.session.isStreaming) {
      return { ok: false, error: "请等待当前回合结束后再执行计划" };
    }
    const planPath = this.planPath;
    const restore = this.savedTools ?? getCachedPrefs().tools;
    this.agentMode = "agent";
    this.savedTools = null;
    this.refreshSystemPrompt(restore);
    this.emitSessionMode();
    this.emitModeNotice(`开始按计划实施：${planPath}`);
    return this.host().prompt(buildImplementPrompt(planPath));
  }

  getPlanContent(): PlanContentResult {
    const bundle = this.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    if (!this.planPath) {
      return { ok: false, error: "尚无计划文件" };
    }
    const cwd = bundle.cwd;
    if (!isAllowedPlanPath(this.planPath, cwd)) {
      return { ok: false, error: "计划路径不在允许的目录内" };
    }
    try {
      const markdown = readPlanMarkdown(this.planPath);
      const loc = classifyPlanLocation(this.planPath, cwd);
      return {
        ok: true,
        path: this.planPath,
        markdown,
        location: loc === "workspace" ? "workspace" : "home",
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  savePlanContent(markdown: string): PlanMutateResult {
    const bundle = this.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    if (!this.planPath) {
      return { ok: false, error: "尚无计划文件" };
    }
    const cwd = bundle.cwd;
    if (!isAllowedPlanPath(this.planPath, cwd)) {
      return { ok: false, error: "计划路径不在允许的目录内" };
    }
    try {
      writePlanMarkdown(this.planPath, markdown);
      const loc = classifyPlanLocation(this.planPath, cwd);
      return {
        ok: true,
        path: this.planPath,
        location: loc === "workspace" ? "workspace" : "home",
        info: this.getInfo(),
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  savePlanToWorkspace(): PlanMutateResult {
    const bundle = this.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    if (!this.planPath) {
      return { ok: false, error: "尚无计划文件" };
    }
    const cwd = bundle.cwd;
    if (!isAllowedPlanPath(this.planPath, cwd)) {
      return { ok: false, error: "计划路径不在允许的目录内" };
    }
    try {
      const nextPath = savePlanToWorkspacePath(this.planPath, cwd);
      this.planPath = nextPath;
      this.persistPlanJournal();
      this.emitSessionMode();
      this.host().emitReplaceableNotice(
        "plan",
        `计划已保存到项目：${nextPath}`,
      );
      return {
        ok: true,
        path: nextPath,
        location: "workspace",
        info: this.getInfo(),
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  clearPlan(): PlanMutateResult {
    if (!this.planPath) {
      return { ok: true, info: this.getInfo() };
    }
    this.planPath = null;
    this.persistPlanJournal();
    this.emitSessionMode();
    this.host().emitReplaceableNotice(
      "plan",
      "已清除当前计划引用（文件仍保留在磁盘）",
    );
    return { ok: true, info: this.getInfo() };
  }

  async setGoal(condition: string): Promise<GoalResult> {
    const bundle = this.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    let toolsAfterReadonly: string[] | undefined;
    if (isReadonlySessionMode(this.agentMode)) {
      toolsAfterReadonly = this.takeRestoredTools();
    }
    const trimmed = condition.trim();
    if (!trimmed) {
      return { ok: false, error: "目标条件不能为空" };
    }
    if (trimmed.length > 4000) {
      return { ok: false, error: "目标条件过长（最多 4000 字符）" };
    }
    const prefs = getCachedPrefs();
    const maxTurns = clampMaxTurns(prefs.goalMaxTurns);
    const maxTokens = clampMaxTokens(prefs.goalMaxTokens);
    this.goal = {
      condition: trimmed,
      status: "pursuing",
      turns: 0,
      maxTurns,
      tokensUsed: 0,
      maxTokens,
      startedAt: Date.now(),
    };
    this.goalTurnLedger = [];
    this.goalEvalGeneration += 1;
    this.goalContinueInFlight = false;
    this.agentMode = "goal";
    this.refreshSystemPrompt(toolsAfterReadonly);
    this.persistGoalJournal();
    this.emitSessionMode();
    this.emitGoal();
    this.emitModeNotice(
      `目标已设置（最多 ${maxTurns} 轮 / ${maxTokens} tokens 自动续）：${trimmed}`,
    );
    const prompted = await this.host().prompt(trimmed);
    if (!prompted.ok) {
      return { ok: false, error: prompted.error, goal: this.goal };
    }
    return { ok: true, goal: this.goal };
  }

  async pauseGoal(): Promise<GoalResult> {
    if (!this.goal) {
      return { ok: false, error: "当前无活跃目标" };
    }
    if (this.goal.status === "paused") {
      return { ok: true, goal: this.goal };
    }
    if (this.goal.status !== "pursuing") {
      return { ok: false, error: `目标状态为 ${this.goal.status}，无法暂停` };
    }
    this.goal.status = "paused";
    this.goalContinueInFlight = false;
    this.goalEvalGeneration += 1;
    this.persistGoalJournal();
    this.emitGoal();
    this.emitModeNotice(`目标已暂停：${this.goal.condition}`);
    return { ok: true, goal: this.goal };
  }

  async resumeGoal(): Promise<GoalResult> {
    const bundle = this.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    if (!this.goal) {
      return { ok: false, error: "当前无活跃目标" };
    }
    if (
      this.goal.status !== "paused" &&
      this.goal.status !== "budget_limited"
    ) {
      if (this.goal.status === "pursuing") {
        return { ok: true, goal: this.goal };
      }
      return { ok: false, error: `目标状态为 ${this.goal.status}，无法继续` };
    }
    if (this.goal.status === "budget_limited") {
      const prefs = getCachedPrefs();
      const nextMaxTurns = clampMaxTurns(prefs.goalMaxTurns);
      const nextMaxTokens = clampMaxTokens(prefs.goalMaxTokens);
      if (
        nextMaxTurns <= this.goal.turns &&
        nextMaxTokens <= this.goal.tokensUsed
      ) {
        return {
          ok: false,
          error: `预算仍不足（轮次 ${this.goal.turns}/${nextMaxTurns}，token ${this.goal.tokensUsed}/${nextMaxTokens}）。请在设置中提高上限后再继续。`,
          goal: this.goal,
        };
      }
      if (nextMaxTurns <= this.goal.turns) {
        return {
          ok: false,
          error: `轮次预算仍不足（已用 ${this.goal.turns}，上限 ${nextMaxTurns}）。请在设置中提高「目标最大轮次」后再继续。`,
          goal: this.goal,
        };
      }
      if (nextMaxTokens <= this.goal.tokensUsed) {
        return {
          ok: false,
          error: `Token 预算仍不足（已用 ${this.goal.tokensUsed}，上限 ${nextMaxTokens}）。请在设置中提高「目标最大 token」后再继续。`,
          goal: this.goal,
        };
      }
      this.goal.maxTurns = nextMaxTurns;
      this.goal.maxTokens = nextMaxTokens;
    }
    this.goal.status = "pursuing";
    this.agentMode = "goal";
    this.refreshSystemPrompt();
    this.persistGoalJournal();
    this.emitSessionMode();
    this.emitGoal();
    this.emitModeNotice(
      `目标已继续（${this.goal.turns}/${this.goal.maxTurns} 轮，${this.goal.tokensUsed}/${this.goal.maxTokens} tokens）：${this.goal.condition}`,
    );
    const reason = this.goal.lastReason ?? "resumed by user";
    const prompted = await this.host().prompt(
      buildGoalContinuePrompt(this.goal.condition, reason),
    );
    if (!prompted.ok) {
      return { ok: false, error: prompted.error, goal: this.goal };
    }
    return { ok: true, goal: this.goal };
  }

  async clearGoal(): Promise<GoalResult> {
    const had = Boolean(this.goal);
    this.clearGoalState("cleared");
    if (this.agentMode === "goal") {
      this.agentMode = "agent";
    }
    this.refreshSystemPrompt();
    this.emitSessionMode();
    this.emitGoal();
    if (!had) {
      this.emitModeNotice("当前无活跃目标");
    }
    return { ok: true, goal: null };
  }

  private hitBudgetLimit(goal: GoalInfo, reason: string): void {
    goal.status = "budget_limited";
    goal.lastReason = reason;
    this.goal = goal;
    this.persistGoalJournal();
    this.emitGoal();
    this.emitModeNotice(
      `已达目标预算（轮次 ${goal.turns}/${goal.maxTurns}，token ${goal.tokensUsed}/${goal.maxTokens}）。可提高设置中的上限后点「继续」，或清除目标。`,
      "warn",
    );
  }

  private pauseAfterEvalFailure(goal: GoalInfo, reason: string): void {
    goal.status = "paused";
    goal.lastReason = reason;
    this.goal = goal;
    this.persistGoalJournal();
    this.emitGoal();
    this.host().emitReplaceableNotice(
      "goal_eval",
      `目标评估失败，已自动暂停续轮：${reason}`,
      "warn",
    );
  }

  async onAgentSettled(): Promise<void> {
    const bundle = this.host().getBundle();
    if (!bundle || this.goal?.status !== "pursuing") return;
    if (this.goalContinueInFlight) return;
    if (bundle.session.isStreaming) return;

    this.goalContinueInFlight = true;
    const goal = this.goal;
    const generation = this.goalEvalGeneration;
    let continuePrompt: string | null = null;
    try {
      const turnTokens = Math.max(0, this.host().getLastTurnTokenTotal());
      const ledgerEntry: GoalTurnLedgerEntry = {
        userEntryId: this.host().getActiveUserEntryId(),
        tokens: turnTokens,
        turnIncremented: false,
      };
      this.goalTurnLedger.push(ledgerEntry);
      goal.tokensUsed += turnTokens;
      this.persistGoalJournal();
      this.emitGoal();
      if (goal.tokensUsed >= goal.maxTokens) {
        this.hitBudgetLimit(
          goal,
          `已用 ${goal.tokensUsed} tokens（上限 ${goal.maxTokens}）`,
        );
        return;
      }

      const transcript = buildGoalTranscript(
        bundle.session.messages as readonly unknown[],
      );
      const evalPrompt = buildGoalEvalPrompt(goal.condition, transcript);
      const model = bundle.session.model;
      if (!model) {
        this.pauseAfterEvalFailure(goal, "当前无可用模型");
        return;
      }
      const runtime = await this.host().ensureRuntime();
      if (this.goalEvalGeneration !== generation) {
        this.dropIncompleteLedgerEntry(ledgerEntry, goal, turnTokens);
        return;
      }
      if (this.host().getBundle() !== bundle || this.goal !== goal) {
        this.dropIncompleteLedgerEntry(ledgerEntry, goal, turnTokens);
        return;
      }
      if (this.goal.status !== "pursuing") return;
      const result = await runtime.completeSimple(
        model,
        {
          messages: [
            {
              role: "user",
              content: evalPrompt,
              timestamp: Date.now(),
            },
          ],
          tools: [],
        },
        { maxTokens: 128, temperature: 0 },
      );
      if (this.goalEvalGeneration !== generation) {
        this.dropIncompleteLedgerEntry(ledgerEntry, goal, turnTokens);
        return;
      }
      if (this.host().getBundle() !== bundle || this.goal !== goal) {
        this.dropIncompleteLedgerEntry(ledgerEntry, goal, turnTokens);
        return;
      }
      if (this.goal.status !== "pursuing") return;
      if (result.stopReason === "error" || result.stopReason === "aborted") {
        this.pauseAfterEvalFailure(goal, result.stopReason);
        return;
      }
      const raw = result.content
        .filter(
          (p): p is { type: "text"; text: string } =>
            !!p &&
            typeof p === "object" &&
            (p as { type?: string }).type === "text" &&
            typeof (p as { text?: unknown }).text === "string",
        )
        .map((p) => p.text)
        .join("")
        .trim();
      const parsed = parseGoalEvalResponse(raw);
      goal.turns += 1;
      ledgerEntry.turnIncremented = true;
      goal.lastReason = parsed.reason;
      this.persistGoalJournal();
      if (parsed.met) {
        goal.status = "achieved";
        this.goal = null;
        this.goalTurnLedger = [];
        this.persistGoalJournal();
        if (this.agentMode === "goal") {
          this.agentMode = "agent";
        }
        this.refreshSystemPrompt();
        this.emitSessionMode();
        this.emitGoal();
        this.emitModeNotice(
          `目标已达成（${goal.turns} 轮）：${parsed.reason}`,
        );
        return;
      }
      if (goal.turns >= goal.maxTurns) {
        this.hitBudgetLimit(
          goal,
          parsed.reason || `已完成 ${goal.turns} 轮仍未达标`,
        );
        return;
      }
      if (goal.tokensUsed >= goal.maxTokens) {
        this.hitBudgetLimit(
          goal,
          `已用 ${goal.tokensUsed} tokens（上限 ${goal.maxTokens}）`,
        );
        return;
      }
      this.emitGoal();
      if (bundle.session.isStreaming) return;
      continuePrompt = buildGoalContinuePrompt(goal.condition, parsed.reason);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.goal === goal && goal.status === "pursuing") {
        this.pauseAfterEvalFailure(goal, message);
      } else {
        this.host().emitReplaceableNotice(
          "goal_eval",
          `目标评估异常：${message}`,
          "warn",
        );
      }
    } finally {
      this.goalContinueInFlight = false;
    }

    // Defer continue outside the settled critical section so the next
    // agent_end can evaluate without nested await / re-entrancy confusion.
    if (
      continuePrompt &&
      this.goalEvalGeneration === generation &&
      this.goal?.status === "pursuing"
    ) {
      void this.host().prompt(continuePrompt);
    }
  }

  applyReadonlyModeTools(
    tools: string[],
  ): { ok: true } | { ok: false; error: string } {
    this.savedTools = [...tools];
    const mode = this.agentMode === "ask" ? "ask" : "plan";
    const modeTools = computeModeToolsForType(this.getSessionType(), mode, tools);
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
    const type = this.getSessionType();
    if (this.agentMode === "ask") {
      this.refreshSystemPrompt(computeModeToolsForType(type, "ask", prefs.tools));
    } else if (this.agentMode === "plan") {
      this.refreshSystemPrompt(computeModeToolsForType(type, "plan", prefs.tools));
    } else if (type === "design") {
      this.refreshSystemPrompt(computeModeToolsForType(type, "agent", prefs.tools));
    } else {
      this.refreshSystemPrompt(prefs.tools);
    }
    this.emitSessionMode();
  }

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

  private dropIncompleteLedgerEntry(
    ledgerEntry: GoalTurnLedgerEntry,
    goal: GoalInfo,
    turnTokens: number,
  ): void {
    const last = this.goalTurnLedger[this.goalTurnLedger.length - 1];
    if (last !== ledgerEntry || ledgerEntry.turnIncremented) return;
    this.goalTurnLedger.pop();
    if (this.goal === goal) {
      goal.tokensUsed = Math.max(0, goal.tokensUsed - turnTokens);
    }
  }
}

/** Best-effort ledger after journal restore (no per-turn entry ids). */
function reconstructLedgerFromGoal(goal: GoalInfo): GoalTurnLedgerEntry[] {
  const turns = Math.max(0, goal.turns);
  const tokens = Math.max(0, goal.tokensUsed);
  if (turns === 0 && tokens === 0) return [];
  if (turns === 0) {
    return [{ userEntryId: null, tokens, turnIncremented: false }];
  }
  const perTurn = Math.floor(tokens / turns);
  const remainder = tokens - perTurn * turns;
  const entries: GoalTurnLedgerEntry[] = [];
  for (let i = 0; i < turns; i++) {
    entries.push({
      userEntryId: null,
      tokens: perTurn + (i === turns - 1 ? remainder : 0),
      turnIncremented: true,
    });
  }
  return entries;
}
