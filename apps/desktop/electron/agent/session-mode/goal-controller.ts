/**
 * Goal mode controller — 主题 B-2 (issue #63, C-404).
 *
 * 负责 goal 模式全生命周期 + 自动续轮评估循环:
 * - setGoal / pauseGoal / resumeGoal / clearGoal (用户命令)
 * - onAgentSettled (每回合结束后评估, 决定继续/达成/暂停/超预算)
 * - rollbackGoalAfterRetract (撤回 pipeline 协调)
 * - restoreGoalFromJournal (会话恢复)
 * - setMode("goal") 时的 applyGoalModeChange (返回 needGoalCondition, 不 emit goal)
 *
 * Goal 私有状态 (`goal` / `goalContinueInFlight` / `goalEvalGeneration` /
 * `goalTurnLedger`) 物理上仍在 SessionModeController 持有 (因为 reset /
 * composeModeAppend / getGoal 都要用), 通过 deps.getGoal()/setGoal() 等访问.
 * 内部 GoalController 自己也镜像一份 read 视图, 用于闭包内引用 (避免 deps
 * 调用在嵌套流程里 stale).
 *
 * 与 SessionModeController 的关系 (composition):
 * - `owner` 暴露 deps 子集 (host / getAgentMode / setAgentMode / takeRestoredTools /
 *   clearGoalState / refreshSystemPrompt / emitSessionMode / emitGoal /
 *   emitModeNotice / getInfo / sessionPath / getGoalState / setGoalState /
 *   getGoalGeneration / bumpGoalGeneration / getContinueInFlight /
 *   setContinueInFlight / getGoalTurnLedger / setGoalTurnLedger).
 * - 测试可独立 mock deps, 不需要造整个 SessionModeController.
 */
import type {
  AgentSessionMode,
  GoalInfo,
  GoalResult,
  GoalStatus,
  SessionModeInfo,
  SessionModeResult,
} from "../../../shared/ipc";
import { isRestorableGoalStatus } from "../../../shared/ipc";
import { DEFAULT_GOAL_MAX_TOKENS, DEFAULT_GOAL_MAX_TURNS } from "../../../shared/ipc";
import type { SessionModeHost } from "../host-interfaces";
import { getCachedPrefs } from "../prefs";
import {
  buildGoalContinuePrompt,
  buildGoalEvalPrompt,
  buildGoalTranscript,
  parseGoalEvalResponse,
  selectEvaluatorModel,
} from "./goal-evaluator";
import { clearGoalJournal, loadGoalJournal, saveGoalJournal } from "./goal-journal";
import { isReadonlySessionMode } from "./plan-tools";

/** Per-turn ledger entry: tracks which user prompt / turn triggered the eval. */
export type GoalTurnLedgerEntry = {
  /** User entry that started the agent turn being evaluated. */
  userEntryId: string | null;
  tokens: number;
  turnIncremented: boolean;
};

/** Goal 状态镜像 (read+write) 通过 deps 暴露给 GoalController. */
export interface GoalControllerDeps {
  host: () => SessionModeHost;
  getAgentMode(): AgentSessionMode;
  setAgentMode(mode: AgentSessionMode): void;
  takeRestoredTools(): string[];
  refreshSystemPrompt(tools?: string[]): void;
  emitSessionMode(): void;
  emitGoal(): void;
  emitModeNotice(text: string, level?: "info" | "warn" | "error"): void;
  getInfo(): SessionModeInfo;
  sessionPath(): string | null;
  // ----- Goal state bridge (state lives on SessionModeController) -----
  getGoalState(): GoalInfo | null;
  setGoalState(goal: GoalInfo | null): void;
  getContinueInFlight(): boolean;
  setContinueInFlight(v: boolean): void;
  getGoalGeneration(): number;
  bumpGoalGeneration(): void;
  getGoalTurnLedger(): GoalTurnLedgerEntry[];
  setGoalTurnLedger(ledger: GoalTurnLedgerEntry[]): void;
}

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

export class GoalController {
  constructor(private readonly owner: GoalControllerDeps) {}

  // ===== setMode("goal") commit (走独立 apply 路径) =====

  /**
   * Goal 模式独立 apply (C-107 例外): 不 emitGoal (有专门 goal emit 路径,
   * 见 setGoal/pauseGoal/clearGoal), 返回 needGoalCondition 让 renderer
   * 决定要不要弹 "请输入完成条件" 提示.
   */
  applyGoalModeChange(): SessionModeResult {
    const tools = isReadonlySessionMode(this.owner.getAgentMode())
      ? this.owner.takeRestoredTools()
      : undefined;
    this.owner.setAgentMode("goal");
    this.owner.refreshSystemPrompt(tools);
    this.owner.emitSessionMode();
    const needGoalCondition = !isRestorableGoalStatus(
      this.owner.getGoalState()?.status,
    );
    this.owner.emitModeNotice(this.computeGoalModeNotice(needGoalCondition));
    return {
      ok: true,
      info: this.owner.getInfo(),
      needGoalCondition,
    };
  }

  /** Goal 模式进入时的 notice 文案 (根据 goal 当前状态). */
  computeGoalModeNotice(needGoalCondition: boolean): string {
    const goal = this.owner.getGoalState();
    if (needGoalCondition || !goal) {
      return "已进入目标模式。请输入可验证的完成条件后发送。";
    }
    if (goal.status === "paused") {
      return `目标已暂停：「${goal.condition}」。可点「继续」恢复自动续轮。`;
    }
    if (goal.status === "budget_limited") {
      return `目标已达预算（轮次 ${goal.turns}/${goal.maxTurns}，token ${goal.tokensUsed}/${goal.maxTokens}）。提高上限后可继续。`;
    }
    return `目标模式：继续推进「${goal.condition}」（${goal.turns}/${goal.maxTurns} 轮，${goal.tokensUsed}/${goal.maxTokens} tokens）`;
  }

  // ===== Goal 状态改写 helper (供 setMode 其他 case 调用清空) =====

  /**
   * 清空 goal 状态. status 通常 "cleared" (用户清除 / 切到其他 mode);
   * "achieved" 仅在 onAgentSettled 走完成路径时使用 (由 GoalController
   * 自身调用). silent=true 用于 setMode("ask"|"plan"|"agent") 时静默
   * 清空不 emit notice.
   */
  clearGoalState(
    status: Extract<GoalStatus, "cleared" | "achieved">,
    opts?: { silent?: boolean; reason?: string },
  ): void {
    const goal = this.owner.getGoalState();
    if (!goal) {
      this.owner.setContinueInFlight(false);
      this.owner.bumpGoalGeneration();
      this.owner.setGoalTurnLedger([]);
      this.persistGoalJournal();
      return;
    }
    const snapshot = goal;
    snapshot.status = status;
    this.owner.setGoalState(null);
    this.owner.setContinueInFlight(false);
    this.owner.bumpGoalGeneration();
    this.owner.setGoalTurnLedger([]);
    this.persistGoalJournal();
    if (!opts?.silent) {
      this.owner.emitModeNotice(
        status === "achieved"
          ? `目标已达成${opts?.reason ? `：${opts.reason}` : ""}`
          : `目标已清除：${snapshot.condition}`,
      );
    }
  }

  // ===== 用户命令 =====

  async setGoal(condition: string): Promise<GoalResult> {
    const bundle = this.owner.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    let toolsAfterReadonly: string[] | undefined;
    if (isReadonlySessionMode(this.owner.getAgentMode())) {
      toolsAfterReadonly = this.owner.takeRestoredTools();
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
    this.owner.setGoalState({
      condition: trimmed,
      status: "pursuing",
      turns: 0,
      maxTurns,
      tokensUsed: 0,
      maxTokens,
      startedAt: Date.now(),
    });
    this.owner.setGoalTurnLedger([]);
    this.owner.bumpGoalGeneration();
    this.owner.setContinueInFlight(false);
    this.owner.setAgentMode("goal");
    this.owner.refreshSystemPrompt(toolsAfterReadonly);
    this.persistGoalJournal();
    this.owner.emitSessionMode();
    this.owner.emitGoal();
    this.owner.emitModeNotice(
      `目标已设置（最多 ${maxTurns} 轮 / ${maxTokens} tokens 自动续）：${trimmed}`,
    );
    const prompted = await this.owner.host().prompt(trimmed);
    if (!prompted.ok) {
      return { ok: false, error: prompted.error, goal: this.owner.getGoalState() };
    }
    return { ok: true, goal: this.owner.getGoalState() };
  }

  async pauseGoal(): Promise<GoalResult> {
    const goal = this.owner.getGoalState();
    if (!goal) {
      return { ok: false, error: "当前无活跃目标" };
    }
    if (goal.status === "paused") {
      return { ok: true, goal };
    }
    if (goal.status !== "pursuing") {
      return { ok: false, error: `目标状态为 ${goal.status}，无法暂停` };
    }
    goal.status = "paused";
    this.owner.setContinueInFlight(false);
    this.owner.bumpGoalGeneration();
    this.persistGoalJournal();
    this.owner.emitGoal();
    this.owner.emitModeNotice(`目标已暂停：${goal.condition}`);
    return { ok: true, goal };
  }

  async resumeGoal(): Promise<GoalResult> {
    const bundle = this.owner.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    const goal = this.owner.getGoalState();
    if (!goal) {
      return { ok: false, error: "当前无活跃目标" };
    }
    if (goal.status !== "paused" && goal.status !== "budget_limited") {
      if (goal.status === "pursuing") {
        return { ok: true, goal };
      }
      return { ok: false, error: `目标状态为 ${goal.status}，无法继续` };
    }
    if (goal.status === "budget_limited") {
      const prefs = getCachedPrefs();
      const nextMaxTurns = clampMaxTurns(prefs.goalMaxTurns);
      const nextMaxTokens = clampMaxTokens(prefs.goalMaxTokens);
      if (nextMaxTurns <= goal.turns && nextMaxTokens <= goal.tokensUsed) {
        return {
          ok: false,
          error: `预算仍不足（轮次 ${goal.turns}/${nextMaxTurns}，token ${goal.tokensUsed}/${nextMaxTokens}）。请在设置中提高上限后再继续。`,
          goal,
        };
      }
      if (nextMaxTurns <= goal.turns) {
        return {
          ok: false,
          error: `轮次预算仍不足（已用 ${goal.turns}，上限 ${nextMaxTurns}）。请在设置中提高「目标最大轮次」后再继续。`,
          goal,
        };
      }
      if (nextMaxTokens <= goal.tokensUsed) {
        return {
          ok: false,
          error: `Token 预算仍不足（已用 ${goal.tokensUsed}，上限 ${nextMaxTokens}）。请在设置中提高「目标最大 token」后再继续。`,
          goal,
        };
      }
      goal.maxTurns = nextMaxTurns;
      goal.maxTokens = nextMaxTokens;
    }
    goal.status = "pursuing";
    this.owner.setAgentMode("goal");
    this.owner.refreshSystemPrompt();
    this.persistGoalJournal();
    this.owner.emitSessionMode();
    this.owner.emitGoal();
    this.owner.emitModeNotice(
      `目标已继续（${goal.turns}/${goal.maxTurns} 轮，${goal.tokensUsed}/${goal.maxTokens} tokens）：${goal.condition}`,
    );
    const reason = goal.lastReason ?? "resumed by user";
    const prompted = await this.owner.host().prompt(
      buildGoalContinuePrompt(goal.condition, reason),
    );
    if (!prompted.ok) {
      return { ok: false, error: prompted.error, goal };
    }
    return { ok: true, goal };
  }

  async clearGoal(): Promise<GoalResult> {
    const had = Boolean(this.owner.getGoalState());
    this.clearGoalState("cleared");
    if (this.owner.getAgentMode() === "goal") {
      this.owner.setAgentMode("agent");
    }
    this.owner.refreshSystemPrompt();
    this.owner.emitSessionMode();
    this.owner.emitGoal();
    if (!had) {
      this.owner.emitModeNotice("当前无活跃目标");
    }
    return { ok: true, goal: null };
  }

  // ===== 自动续轮 (每回合结束后评估) =====

  /**
   * After a successful retract, drop budget for abandoned user turns so
   * continue/regenerate does not double-count turns or tokens.
   */
  rollbackGoalAfterRetract(abandonedUserEntryIds: readonly string[]): void {
    const goal = this.owner.getGoalState();
    if (!goal) {
      this.owner.setContinueInFlight(false);
      this.owner.bumpGoalGeneration();
      return;
    }
    this.owner.setContinueInFlight(false);
    this.owner.bumpGoalGeneration();

    const abandoned = new Set(
      abandonedUserEntryIds.filter((id) => typeof id === "string" && id),
    );
    if (abandoned.size === 0) {
      this.owner.emitGoal();
      return;
    }

    const ledger = this.owner.getGoalTurnLedger();
    const matched = ledger.some(
      (e) => e.userEntryId && abandoned.has(e.userEntryId),
    );
    if (matched) {
      this.owner.setGoalTurnLedger(
        ledger.filter((e) => !e.userEntryId || !abandoned.has(e.userEntryId)),
      );
    } else {
      // Journal-restored synthetic ledger has no entry ids — pop N from end.
      const drop = Math.min(abandoned.size, ledger.length);
      if (drop > 0) this.owner.setGoalTurnLedger(ledger.slice(0, ledger.length - drop));
    }

    this.resyncGoalBudgetFromLedger();
    if (goal.status === "budget_limited") {
      goal.status = "paused";
      goal.lastReason = "撤回后预算已回滚，可点「继续」";
    }
    this.persistGoalJournal();
    this.owner.emitGoal();
  }

  /** Resync turns/tokensUsed from the current ledger state. */
  private resyncGoalBudgetFromLedger(): void {
    const goal = this.owner.getGoalState();
    if (!goal) return;
    const ledger = this.owner.getGoalTurnLedger();
    goal.turns = ledger.filter((e) => e.turnIncremented).length;
    goal.tokensUsed = ledger.reduce((sum, e) => sum + e.tokens, 0);
  }

  /**
   * Restore a pursuing/paused/budget_limited goal from disk after resumeSession.
   */
  restoreGoalFromJournal(): void {
    const path = this.owner.sessionPath();
    if (!path) return;
    const stored = loadGoalJournal(path);
    if (!stored) return;
    this.owner.setGoalState(stored);
    this.owner.setGoalTurnLedger(reconstructLedgerFromGoal(stored));
    this.owner.bumpGoalGeneration();
    this.owner.setContinueInFlight(false);
    if (isRestorableGoalStatus(stored.status)) {
      this.owner.setAgentMode("goal");
      this.owner.refreshSystemPrompt();
    }
    this.owner.emitSessionMode();
    this.owner.emitGoal();
  }

  async onAgentSettled(): Promise<void> {
    const bundle = this.owner.host().getBundle();
    if (!bundle) return;
    const goal = this.owner.getGoalState();
    if (goal?.status !== "pursuing") return;
    if (this.owner.getContinueInFlight()) return;
    if (bundle.session.isStreaming) return;

    this.owner.setContinueInFlight(true);
    const goalAtStart = goal;
    const generation = this.owner.getGoalGeneration();
    let continuePrompt: string | null = null;
    try {
      const turnTokens = Math.max(0, this.owner.host().getLastTurnTokenTotal());
      const ledgerEntry: GoalTurnLedgerEntry = {
        userEntryId: this.owner.host().getActiveUserEntryId(),
        tokens: turnTokens,
        turnIncremented: false,
      };
      this.owner.getGoalTurnLedger().push(ledgerEntry);
      goalAtStart.tokensUsed += turnTokens;
      this.persistGoalJournal();
      this.owner.emitGoal();
      if (goalAtStart.tokensUsed >= goalAtStart.maxTokens) {
        this.hitBudgetLimit(
          goalAtStart,
          `已用 ${goalAtStart.tokensUsed} tokens（上限 ${goalAtStart.maxTokens}）`,
        );
        return;
      }

      const transcript = buildGoalTranscript(
        bundle.session.messages as readonly unknown[],
      );
      const evalPrompt = buildGoalEvalPrompt(goalAtStart.condition, transcript);
      const sessionModel = bundle.session.model;
      if (!sessionModel) {
        this.pauseAfterEvalFailure(goalAtStart, "当前无可用模型");
        return;
      }
      const runtime = await this.owner.host().ensureRuntime();
      if (this.owner.getGoalGeneration() !== generation) {
        this.dropIncompleteLedgerEntry(ledgerEntry, goalAtStart, turnTokens);
        return;
      }
      if (this.owner.host().getBundle() !== bundle || this.owner.getGoalState() !== goalAtStart) {
        this.dropIncompleteLedgerEntry(ledgerEntry, goalAtStart, turnTokens);
        return;
      }
      if (this.owner.getGoalState()?.status !== "pursuing") return;
      // Issue #1: pick a dedicated small/fast evaluator model when the user
      // has set `goalEvaluatorModel` in prefs. Falls back to the session model
      // when the pref is empty or unresolvable. We re-resolve from the
      // runtime in the `"pref"` branch so we pass a full `Model<TApi>` to
      // `completeSimple`; otherwise just keep the live session model.
      const selection = selectEvaluatorModel({
        runtime,
        sessionModel: { id: sessionModel.id, provider: sessionModel.provider },
        pref: getCachedPrefs().goalEvaluatorModel,
      });
      let model: typeof sessionModel;
      if (selection.source === "pref" && selection.model) {
        const full = runtime.getModel(
          selection.model.provider,
          selection.model.id,
        );
        // We just confirmed `getModel` returns the pref model, so this cast
        // is safe. (Re-resolve rather than fabricating a partial Model.)
        model = (full ?? sessionModel) as typeof sessionModel;
      } else {
        model = sessionModel;
      }
      if (selection.source === "fallback") {
        // Pref was set but couldn't be resolved. Warn once so the user can
        // either fix the spec or unset it. We do this here (not in the helper)
        // because the helper is intentionally pure / no I/O.
        this.owner.host().emitReplaceableNotice(
          "goal_eval",
          `目标评估模型 ${selection.prefRequested ?? ""} 不可用，已回退到当前会话模型`,
          "warn",
        );
      }
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
      if (this.owner.getGoalGeneration() !== generation) {
        this.dropIncompleteLedgerEntry(ledgerEntry, goalAtStart, turnTokens);
        return;
      }
      if (this.owner.host().getBundle() !== bundle || this.owner.getGoalState() !== goalAtStart) {
        this.dropIncompleteLedgerEntry(ledgerEntry, goalAtStart, turnTokens);
        return;
      }
      if (this.owner.getGoalState()?.status !== "pursuing") return;
      if (result.stopReason === "error" || result.stopReason === "aborted") {
        this.pauseAfterEvalFailure(goalAtStart, result.stopReason);
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
      goalAtStart.turns += 1;
      ledgerEntry.turnIncremented = true;
      goalAtStart.lastReason = parsed.reason;
      this.persistGoalJournal();
      if (parsed.met) {
        goalAtStart.status = "achieved";
        this.owner.setGoalState(null);
        this.owner.setGoalTurnLedger([]);
        this.persistGoalJournal();
        if (this.owner.getAgentMode() === "goal") {
          this.owner.setAgentMode("agent");
        }
        this.owner.refreshSystemPrompt();
        this.owner.emitSessionMode();
        this.owner.emitGoal();
        this.owner.emitModeNotice(
          `目标已达成（${goalAtStart.turns} 轮）：${parsed.reason}`,
        );
        return;
      }
      if (goalAtStart.turns >= goalAtStart.maxTurns) {
        this.hitBudgetLimit(
          goalAtStart,
          parsed.reason || `已完成 ${goalAtStart.turns} 轮仍未达标`,
        );
        return;
      }
      if (goalAtStart.tokensUsed >= goalAtStart.maxTokens) {
        this.hitBudgetLimit(
          goalAtStart,
          `已用 ${goalAtStart.tokensUsed} tokens（上限 ${goalAtStart.maxTokens}）`,
        );
        return;
      }
      this.owner.emitGoal();
      if (bundle.session.isStreaming) return;
      continuePrompt = buildGoalContinuePrompt(goalAtStart.condition, parsed.reason);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const current = this.owner.getGoalState();
      if (current === goalAtStart && goalAtStart.status === "pursuing") {
        this.pauseAfterEvalFailure(goalAtStart, message);
      } else {
        this.owner.host().emitReplaceableNotice(
          "goal_eval",
          `目标评估异常：${message}`,
          "warn",
        );
      }
    } finally {
      this.owner.setContinueInFlight(false);
    }

    // Defer continue outside the settled critical section so the next
    // agent_end can evaluate without nested await / re-entrancy confusion.
    if (
      continuePrompt &&
      this.owner.getGoalGeneration() === generation &&
      this.owner.getGoalState()?.status === "pursuing"
    ) {
      void this.owner.host().prompt(continuePrompt);
    }
  }

  /** Mark goal as budget-limited and emit a warn notice. */
  private hitBudgetLimit(goal: GoalInfo, reason: string): void {
    goal.status = "budget_limited";
    goal.lastReason = reason;
    this.owner.setGoalState(goal);
    this.persistGoalJournal();
    this.owner.emitGoal();
    this.owner.emitModeNotice(
      `已达目标预算（轮次 ${goal.turns}/${goal.maxTurns}，token ${goal.tokensUsed}/${goal.maxTokens}）。可提高设置中的上限后点「继续」，或清除目标。`,
      "warn",
    );
  }

  /** Pause goal after eval failure and emit a warn notice (replaces previous). */
  private pauseAfterEvalFailure(goal: GoalInfo, reason: string): void {
    goal.status = "paused";
    goal.lastReason = reason;
    this.owner.setGoalState(goal);
    this.persistGoalJournal();
    this.owner.emitGoal();
    this.owner.host().emitReplaceableNotice(
      "goal_eval",
      `目标评估失败，已自动暂停续轮：${reason}`,
      "warn",
    );
  }

  /** Drop the most recent ledger entry that didn't yet increment a turn. */
  private dropIncompleteLedgerEntry(
    ledgerEntry: GoalTurnLedgerEntry,
    goal: GoalInfo,
    turnTokens: number,
  ): void {
    const ledger = this.owner.getGoalTurnLedger();
    const last = ledger[ledger.length - 1];
    if (last !== ledgerEntry || ledgerEntry.turnIncremented) return;
    this.owner.setGoalTurnLedger(ledger.slice(0, -1));
    if (this.owner.getGoalState() === goal) {
      goal.tokensUsed = Math.max(0, goal.tokensUsed - turnTokens);
    }
  }

  /** Persist the current goal (or clear journal) to disk. */
  private persistGoalJournal(): void {
    const path = this.owner.sessionPath();
    if (!path) return;
    const goal = this.owner.getGoalState();
    if (goal && isRestorableGoalStatus(goal.status)) {
      saveGoalJournal(path, goal);
    } else {
      clearGoalJournal(path);
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
