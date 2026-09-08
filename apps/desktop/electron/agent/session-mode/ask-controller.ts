/**
 * Ask (调研) mode controller — 主题 B-2 (issue #63, C-404).
 *
 * Ask 模式是 4 case 中最轻量的一个: 只读工具集 + readonly-mode 提示.
 * 没有 plan 文档/goal 状态需要管理, 因此独立成单一 file + class.
 *
 * 与 SessionModeController 的关系 (composition):
 * - `owner` 暴露 deps 子集 (getPlanPath / clearGoalState /
 *   captureSavedToolsFromSession / getSessionTypePolicy).
 * - `buildCaseConfig()` 返回 ModeCaseConfig, 由 SessionModeController.setMode
 *   走 applyModeChange 模板执行.
 * - 测试可独立 mock deps, 不需要造整个 SessionModeController.
 */
import type { GoalStatus, SessionModeResult } from "../../../shared/ipc";
import type { SessionTypePolicy } from "../session-type-policy";
import { getCachedPrefs } from "../prefs";
import { computeModeToolsForType } from "./plan-tools";

/**
 * Ask (调研) 模式 commit config. 走 SessionModeController.applyModeChange
 * 模板 (C-107): set agentMode → pre → refreshSystemPrompt → emit session/goal
 * → emit notice. 无 rollback (ask 不需要 validate 写工具).
 */
export type AskCaseConfig = {
  pre?: () => void;
  tools: string[] | undefined;
  notice: () => string;
  rollback?: () => SessionModeResult | null;
};

export interface AskControllerDeps {
  getPlanPath(): string | null;
  clearGoalState(
    status: Extract<GoalStatus, "cleared" | "achieved">,
    opts?: { silent?: boolean },
  ): void;
  captureSavedToolsFromSession(): void;
  getSessionTypePolicy(): SessionTypePolicy;
}

export class AskController {
  constructor(private readonly owner: AskControllerDeps) {}

  /** Build the ask case config for SessionModeController.applyModeChange. */
  buildCaseConfig(): AskCaseConfig {
    return {
      pre: () => {
        this.owner.clearGoalState("cleared", { silent: true });
        this.owner.captureSavedToolsFromSession();
      },
      tools: computeModeToolsForType(
        this.owner.getSessionTypePolicy(),
        "ask",
        getCachedPrefs().tools,
      ),
      notice: () => this.modeNotice(),
    };
  }

  /** Ask 模式 notice 文案 (planPath-aware). */
  modeNotice(): string {
    const planPath = this.owner.getPlanPath();
    return planPath
      ? `已进入调研模式（只读问答）。右栏「计划」仍保留：${planPath}`
      : "已进入调研模式（只读研究与问答，不改文件）。需要可执行方案请切 Plan。";
  }
}
