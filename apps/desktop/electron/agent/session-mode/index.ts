/**
 * 会话模式 — Ask / Plan / Goal lifecycle (main process).
 * External callers should import from this index.
 */
export { SessionModeController } from "./controller";
// SessionModeHost 类型从 ../host-interfaces 导出 (issue #59 主题 A 收口).
export type { SessionModeHost } from "../host-interfaces";
export {
  computeAskModeTools,
  computePlanModeTools,
  computeModeTools,
  computeModeToolsForType,
  createWritePlanTools,
  isReadonlySessionMode,
  buildImplementPrompt,
  withoutWritePlan,
} from "./plan-tools";
export { createPlanModeGuardExtension } from "./plan-mode-guard";
export {
  isReadonlyBashCommand,
  readonlyBashBlockReason,
  bashCommandEscapesCwd,
  cwdEscapeBashBlockReason,
} from "./bash-readonly";
export {
  buildGoalContinuePrompt,
  buildGoalEvalPrompt,
  buildGoalTranscript,
  parseGoalEvalResponse,
} from "./goal-evaluator";
export {
  clearGoalJournal,
  loadGoalJournal,
  saveGoalJournal,
} from "./goal-journal";
export {
  clearPlanJournal,
  loadPlanJournal,
  savePlanJournal,
} from "./plan-journal";
