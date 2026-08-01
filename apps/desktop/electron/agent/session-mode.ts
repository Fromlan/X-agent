import type { AgentSession, DefaultResourceLoader, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  AgentSessionMode,
  GoalInfo,
  GoalResult,
  PlanContentResult,
  PlanMutateResult,
  PromptResult,
  SessionModeInfo,
  SessionModeResult,
  UiAgentEvent,
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
  buildAskModeSystemAppend,
  buildGoalModeSystemAppend,
  buildPlanModeSystemAppend,
} from "../../shared/mode-prompt";

export type SessionModeHost = {
  getBundle(): { session: AgentSession; cwd: string } | null;
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
};

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
          mode === "goal" && this.goal?.status !== "pursuing",
      };
    }

    if (mode === "ask") {
      // Mutual exclusion: drop Goal. Keep planPath across Agent ↔ 调研 ↔ Plan.
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
      // Mutual exclusion: drop Goal. Keep existing planPath so switching
      // Agent ↔ Plan does not lose the right-panel plan artifact.
      this.clearGoalState("cleared", { silent: true });
      this.captureSavedToolsFromSession();
      const prefs = loadPrefs();
      this.agentMode = "plan";
      this.refreshSystemPrompt(computePlanModeTools(prefs.tools));
      const active = bundle.session.getActiveToolNames();
      if (!active.includes("write_plan")) {
        // Roll back to Agent so UI/tools stay consistent.
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
      // Mutual exclusion: leave ask/plan tools, keep planPath for the Plan tab.
      let tools: string[] | undefined;
      if (isReadonlySessionMode(this.agentMode)) {
        tools = this.takeRestoredTools();
      }
      this.agentMode = "goal";
      this.refreshSystemPrompt(tools);
      this.emitSessionMode();
      const needGoalCondition = this.goal?.status !== "pursuing";
      this.emitModeNotice(
        needGoalCondition
          ? "已进入目标模式。请输入可验证的完成条件后发送。"
          : `目标模式：继续推进「${this.goal!.condition}」`,
      );
      return {
        ok: true,
        info: this.getInfo(),
        needGoalCondition,
      };
    }

    // mode === "agent" — leave ask/plan tools + Goal; keep planPath for review/re-run.
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

  /** Clear in-memory goal without requiring a bundle; optionally skip notices. */
  private clearGoalState(
    status: "cleared" | "achieved",
    opts?: { silent?: boolean; reason?: string },
  ): void {
    if (!this.goal) {
      this.goalContinueInFlight = false;
      return;
    }
    const snapshot = this.goal;
    snapshot.status = status;
    this.goal = null;
    this.goalContinueInFlight = false;
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

  /** Drop the session plan pointer (does not delete the file on disk). */
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
    // Mutual exclusion: leave ask/plan tools if needed; keep planPath for the Plan tab.
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
    this.goal = {
      condition: trimmed,
      status: "pursuing",
      turns: 0,
      startedAt: Date.now(),
    };
    this.agentMode = "goal";
    this.refreshSystemPrompt(toolsAfterReadonly);
    this.emitSessionMode();
    this.emitGoal();
    this.emitModeNotice(`目标已设置：${trimmed}`);
    const prompted = await this.host().prompt(trimmed);
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

  async onAgentSettled(): Promise<void> {
    const bundle = this.host().getBundle();
    if (!bundle || this.goal?.status !== "pursuing") return;
    if (this.goalContinueInFlight) return;
    if (bundle.session.isStreaming) return;

    this.goalContinueInFlight = true;
    const goal = this.goal;
    try {
      const transcript = buildGoalTranscript(
        bundle.session.messages as readonly unknown[],
      );
      const evalPrompt = buildGoalEvalPrompt(goal.condition, transcript);
      const model = bundle.session.model;
      if (!model) {
        this.host().emitReplaceableNotice(
          "goal_eval",
          "目标评估跳过：当前无可用模型",
          "warn",
        );
        return;
      }
      const runtime = await this.host().ensureRuntime();
      if (this.host().getBundle() !== bundle || this.goal !== goal) return;
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
      if (result.stopReason === "error" || result.stopReason === "aborted") {
        this.host().emitReplaceableNotice(
          "goal_eval",
          "目标评估失败，已暂停自动续轮",
          "warn",
        );
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
      if (parsed.met) {
        goal.status = "achieved";
        this.goal = null;
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
      this.emitGoal();
      if (bundle.session.isStreaming) return;
      // Release lock before continue prompt so that turn's agent_end can evaluate.
      this.goalContinueInFlight = false;
      await this.host().prompt(
        buildGoalContinuePrompt(goal.condition, parsed.reason),
      );
      return;
    } catch (err) {
      this.host().emitReplaceableNotice(
        "goal_eval",
        `目标评估异常：${err instanceof Error ? err.message : String(err)}`,
        "warn",
      );
    } finally {
      this.goalContinueInFlight = false;
    }
  }

  /**
   * Ask/Plan branch for applyTools: update savedTools and refresh the
   * temporary read-only tool set for the current mode.
   */
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

  /** @deprecated Prefer applyReadonlyModeTools */
  applyPlanModeTools(
    tools: string[],
  ): { ok: true } | { ok: false; error: string } {
    return this.applyReadonlyModeTools(tools);
  }

  /** After resource reload: re-apply mode system append + active tools. */
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
