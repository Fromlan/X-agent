/**
 * Stage subsystem — public exports.
 *
 * External callers should import from this index.
 */
export { StageController, type StageChangeListener } from "./controller";
export { loadStage, saveStage, clearStage, stageJsonPath, ensureStageDir } from "./persistence";
export { ensureStageArtifacts, summarizeArtifacts } from "./artifacts";
export { evaluateGraduation } from "./graduation";
