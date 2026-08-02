/**
 * 会话模式 — Ask / Plan / Goal lifecycle (main process).
 * External callers should import from this index.
 */
export {
  SessionModeController,
  type SessionModeHost,
} from "./controller";
export {
  computeAskModeTools,
  computePlanModeTools,
  computeModeTools,
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
