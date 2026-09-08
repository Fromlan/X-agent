/**
 * Plan mode controller — 主题 B-2 (issue #63, C-404).
 *
 * 负责 plan 模式生命周期 + plan 文档/计划文件业务:
 * - onPlanWritten (write_plan 工具回调) / getPlanPath / setPlanPath
 * - buildPlan (执行计划) / getPlanContent / savePlanContent / savePlanToWorkspace / clearPlan
 * - restorePlanFromJournal (会话恢复)
 * - setMode("plan") 时的 case config (buildCaseConfig) + write_plan rollback helper
 *
 * 状态 `planPath` 物理上放在 SessionModeController (因为 emitSessionMode /
 * getInfo 都要用到), 通过 deps.getPlanPath()/setPlanPath() 访问. PlanController
 * 自己不持 private state, 避免与 SessionModeController 双向 sync.
 *
 * 与 SessionModeController 的关系 (composition):
 * - `owner` 暴露 deps 子集 (host / getPlanPath / setPlanPath / getAgentMode /
 *   setAgentMode / takeRestoredTools / captureSavedToolsFromSession /
 *   clearGoalState / getSessionTypePolicy / emitModeNotice / emitSessionMode /
 *   refreshSystemPrompt / getInfo / persistPlanJournal / sessionPath).
 * - 测试可独立 mock deps, 不需要造整个 SessionModeController.
 */
import { existsSync } from "node:fs";
import type {
  AgentSessionMode,
  GoalStatus,
  PlanContentResult,
  PlanMutateResult,
  PromptResult,
  SessionModeInfo,
  SessionModeResult,
} from "../../../shared/ipc";
import type { SessionModeHost } from "../host-interfaces";
import type { SessionTypePolicy } from "../session-type-policy";
import { getCachedPrefs } from "../prefs";
import {
  buildImplementPrompt,
  classifyPlanLocation,
  computeModeToolsForType,
  isAllowedPlanPath,
  readPlanMarkdown,
  savePlanToWorkspacePath,
  writePlanMarkdown,
} from "./plan-tools";
import { clearPlanJournal, loadPlanJournal } from "./plan-journal";

/**
 * Plan 模式 commit config. 走 SessionModeController.applyModeChange 模板 (C-107).
 * 唯一带 rollback 的 case (write_plan 校验失败时回滚到 agent).
 */
export type PlanCaseConfig = {
  pre?: () => void;
  tools: string[] | undefined;
  notice: () => string;
  rollback?: () => SessionModeResult | null;
};

export interface PlanControllerDeps {
  host: () => SessionModeHost;
  getPlanPath(): string | null;
  setPlanPath(path: string | null): void;
  getAgentMode(): AgentSessionMode;
  setAgentMode(mode: AgentSessionMode): void;
  takeRestoredTools(): string[];
  captureSavedToolsFromSession(): void;
  clearGoalState(
    status: Extract<GoalStatus, "cleared" | "achieved">,
    opts?: { silent?: boolean },
  ): void;
  getSessionTypePolicy(): SessionTypePolicy;
  refreshSystemPrompt(tools?: string[]): void;
  emitSessionMode(): void;
  emitModeNotice(text: string, level?: "info" | "warn" | "error"): void;
  getInfo(): SessionModeInfo;
  sessionPath(): string | null;
}

export class PlanController {
  constructor(private readonly owner: PlanControllerDeps) {}

  // ===== setMode("plan") commit config =====

  /** Build the plan case config for SessionModeController.applyModeChange. */
  buildCaseConfig(): PlanCaseConfig {
    return {
      pre: () => {
        this.owner.clearGoalState("cleared", { silent: true });
        this.owner.captureSavedToolsFromSession();
      },
      tools: computeModeToolsForType(
        this.owner.getSessionTypePolicy(),
        "plan",
        getCachedPrefs().tools,
      ),
      notice: () => this.modeNotice(),
      rollback: () => this.rollbackIfWritePlanMissing(),
    };
  }

  /** Plan 模式 notice 文案 (planPath-aware). */
  modeNotice(): string {
    const planPath = this.owner.getPlanPath();
    return planPath
      ? `已进入 Plan 模式。当前计划仍保留在右栏「计划」：${planPath}`
      : "已进入 Plan 模式（只读研究 + write_plan）。完成后在右栏审阅并「执行计划」。";
  }

  /**
   * Plan 模式回滚 helper (C-107): write_plan 未激活时回滚到 agent + emit error.
   * 失败时返回 { ok: false, ... } 阻止进入 plan 模式; 成功 (write_plan 激活)
   * 返回 null 让 apply 继续走 commit 完成路径.
   */
  rollbackIfWritePlanMissing(): SessionModeResult | null {
    const bundle = this.owner.host().getBundle();
    if (!bundle) return null;
    const active = bundle.session.getActiveToolNames();
    if (active.includes("write_plan")) return null;
    const restore = this.owner.takeRestoredTools();
    this.owner.setAgentMode("agent");
    this.owner.refreshSystemPrompt(restore);
    this.owner.emitSessionMode();
    this.owner.host().emitReplaceableNotice(
      "plan",
      "Plan 模式未能激活 write_plan（工具未注册）。请重开项目后再试。",
      "error",
    );
    return {
      ok: false,
      error: "write_plan 未激活，无法写出计划文件",
      info: this.owner.getInfo(),
    };
  }

  // ===== Plan 文档/计划文件业务 =====

  /** write_plan 工具回调: 写入 planPath 并通知 UI. */
  onPlanWritten(path: string): void {
    this.owner.setPlanPath(path);
    this.owner.emitSessionMode();
    this.owner.host().emitReplaceableNotice(
      "plan",
      `计划已写入：${path}。可在右栏「计划」中编辑，或点击「执行计划」。`,
    );
  }

  /**
   * Build the prompt that starts the plan implementation, switching the
   * controller back to agent mode and clearing any saved read-only tools.
   * Returns `{ ok: false, error }` when no project / no plan / mid-stream.
   */
  async buildPlan(): Promise<PromptResult> {
    const bundle = this.owner.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    const planPath = this.owner.getPlanPath();
    if (!planPath) {
      return {
        ok: false,
        error: "尚无计划文件。请先在 Plan 模式下让 Agent 调用 write_plan。",
      };
    }
    if (bundle.session.isStreaming) {
      return { ok: false, error: "请等待当前回合结束后再执行计划" };
    }
    const restore = this.owner.takeRestoredTools();
    this.owner.setAgentMode("agent");
    this.owner.refreshSystemPrompt(restore);
    this.owner.emitSessionMode();
    this.owner.emitModeNotice(`开始按计划实施：${planPath}`);
    return this.owner.host().prompt(buildImplementPrompt(planPath));
  }

  /** Read the plan markdown (home/workspace paths only). */
  getPlanContent(): PlanContentResult {
    const bundle = this.owner.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    const planPath = this.owner.getPlanPath();
    if (!planPath) {
      return { ok: false, error: "尚无计划文件" };
    }
    const cwd = bundle.cwd;
    if (!isAllowedPlanPath(planPath, cwd)) {
      return { ok: false, error: "计划路径不在允许的目录内" };
    }
    try {
      const markdown = readPlanMarkdown(planPath);
      const loc = classifyPlanLocation(planPath, cwd);
      return {
        ok: true,
        path: planPath,
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

  /** Overwrite the plan file (home/workspace paths only). */
  savePlanContent(markdown: string): PlanMutateResult {
    const bundle = this.owner.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    const planPath = this.owner.getPlanPath();
    if (!planPath) {
      return { ok: false, error: "尚无计划文件" };
    }
    const cwd = bundle.cwd;
    if (!isAllowedPlanPath(planPath, cwd)) {
      return { ok: false, error: "计划路径不在允许的目录内" };
    }
    try {
      writePlanMarkdown(planPath, markdown);
      const loc = classifyPlanLocation(planPath, cwd);
      return {
        ok: true,
        path: planPath,
        location: loc === "workspace" ? "workspace" : "home",
        info: this.owner.getInfo(),
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Save the plan into `<cwd>/.pi/plans/` and update the in-memory + journal ref. */
  savePlanToWorkspace(): PlanMutateResult {
    const bundle = this.owner.host().getBundle();
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    const planPath = this.owner.getPlanPath();
    if (!planPath) {
      return { ok: false, error: "尚无计划文件" };
    }
    const cwd = bundle.cwd;
    if (!isAllowedPlanPath(planPath, cwd)) {
      return { ok: false, error: "计划路径不在允许的目录内" };
    }
    try {
      const nextPath = savePlanToWorkspacePath(planPath, cwd);
      this.owner.setPlanPath(nextPath);
      this.owner.emitSessionMode();
      this.owner.host().emitReplaceableNotice(
        "plan",
        `计划已保存到项目：${nextPath}`,
      );
      return {
        ok: true,
        path: nextPath,
        location: "workspace",
        info: this.owner.getInfo(),
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Drop the in-memory plan ref (file stays on disk). */
  clearPlan(): PlanMutateResult {
    if (!this.owner.getPlanPath()) {
      return { ok: true, info: this.owner.getInfo() };
    }
    this.owner.setPlanPath(null);
    this.owner.emitSessionMode();
    this.owner.host().emitReplaceableNotice(
      "plan",
      "已清除当前计划引用（文件仍保留在磁盘）",
    );
    return { ok: true, info: this.owner.getInfo() };
  }

  /**
   * Restore the plan reference from disk after resumeSession, so the right
   * panel Plan tab shows the plan again after an app restart.
   * Skips (and clears) when the file is gone or the path is outside the
   * allowed plan roots (home plans dir / cwd .pi/plans).
   */
  restorePlanFromJournal(): void {
    const path = this.owner.sessionPath();
    if (!path) return;
    const stored = loadPlanJournal(path);
    if (!stored) return;
    const cwd = this.owner.host().getBundle()?.cwd ?? null;
    if (!existsSync(stored) || !isAllowedPlanPath(stored, cwd)) {
      clearPlanJournal(path);
      return;
    }
    this.owner.setPlanPath(stored);
    this.owner.emitSessionMode();
  }
}
