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
  UiAgentEvent,
} from "../../shared/ipc";
import {
  DEFAULT_GOAL_MAX_TOKENS,
  DEFAULT_GOAL_MAX_TURNS,
  isRestorableGoalStatus,
} from "../../shared/ipc";
import { loadPrefs } from "./prefs";
import {
  buildImplementPrompt,
  classifyPlanLocation,
  computeAskModeTools,
  computeModeTools,
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
  buildAskModeSystemAppend,
  buildGoalModeSystemAppend,
  buildPlanModeSystemAppend,
} from "../../shared/mode-prompt";

export type SessionModeHost = {
  getBundle(): {
    session: AgentSession;
    cwd: string;
    sessionPath?: string | null;
  } | null;
  getResourceLoader(): DefaultResourceLoader | null;
  getBaseAppendPrompt(): string[];
  setBaseAppendPrompt(base: string[]): void;
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

  constructor(private readonly host: () => SessionModeHost) {}

  getMode(): AgentSessionMode {
    return this.agentMode;
  }

  getPlanPath(): string | null {
    return this.planPath;
  }

  setPlanPath(path: string | null): void {
    this.planPath = path;
  }

  /** write_plan callback: set path and notify UI. */
  onPlanWritten(path: string): void {
    this.planPath = path;
    this.emitSessionMode();
    this.host().emitReplaceableNotice(
      "plan",
      `计划已写入：${path}。可在右栏「计划」中编辑，或点击「执行计划」。`,
    );
  }

  composeModeAppend(base: string[]): string[] {
    const out = [...base];
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
    const prefs = loadPrefs();
    this.savedTools = withoutWritePlan(bundle.session.getActiveToolNames());
    if (this.savedTools.length === 0) {
      this.savedTools = [...prefs.tools];
    }
  }

  /** Restore tools saved before ask/plan; clear savedTools. */
  private takeRestoredTools(): string[] {
    const tools = this.savedTools ?? loadPrefs().tools;
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

  /**
   * Restore a pursuing/paused/budget_limited goal from disk after resumeSession.
   */
  restoreGoalFromJournal(): void {
    const path = this.sessionPath();
    if (!path) return;
    const stored = loadGoalJournal(path);
    if (!stored) return;
    this.goal = stored;
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
      const prefs = loadPrefs();
      this.agentMode = "ask";
      this.refreshSystemPrompt(computeAskModeTools(prefs.tools));
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
      const prefs = loadPrefs();
      this.agentMode = "plan";
      this.refreshSystemPrompt(computePlanModeTools(prefs.tools));
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
      this.persistGoalJournal();
      return;
    }
    const snapshot = this.goal;
    snapshot.status = status;
    this.goal = null;
    this.goalContinueInFlight = false;
    this.persistGoalJournal();
    if (!opts?.silent) {
      this.emitModeNotice(
        status === "achieved"
          ? `目标已达成${opts?.reason ? `：${opts.reason}` : ""}`
          : `目标已清除：${snapshot.condition}`,
      );
    }
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
    const restore = this.savedTools ?? loadPrefs().tools;
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
    const prefs = loadPrefs();
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
      const prefs = loadPrefs();
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
    try {
      const turnTokens = Math.max(0, this.host().getLastTurnTokenTotal());
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
      if (this.host().getBundle() !== bundle || this.goal !== goal) return;
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
      if (this.host().getBundle() !== bundle || this.goal !== goal) return;
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
      goal.lastReason = parsed.reason;
      this.persistGoalJournal();
      if (parsed.met) {
        goal.status = "achieved";
        this.goal = null;
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
      this.goalContinueInFlight = false;
      await this.host().prompt(
        buildGoalContinuePrompt(goal.condition, parsed.reason),
      );
      return;
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
  }

  applyReadonlyModeTools(
    tools: string[],
  ): { ok: true } | { ok: false; error: string } {
    this.savedTools = [...tools];
    const mode = this.agentMode === "ask" ? "ask" : "plan";
    const modeTools = computeModeTools(mode, tools);
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
    const prefs = loadPrefs();
    if (this.agentMode === "ask") {
      this.refreshSystemPrompt(computeAskModeTools(prefs.tools));
    } else if (this.agentMode === "plan") {
      this.refreshSystemPrompt(computePlanModeTools(prefs.tools));
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
}
