/**
 * Stage-aware tool computation.
 *
 * A game stage can widen the active tool set (prototype/test/expansion auto
 * enable relevant Godot tools) or narrow it (planning behaves like Plan mode).
 * The existing session modes still win for Ask/Plan; Agent/Goal modes use the
 * stage preset while keeping the user's prefs as the base.
 */
import type { AgentSessionMode } from "../../../shared/ipc";
import { GODOT_TOOLS } from "../../../shared/ipc";
import type { GameStage } from "../../../shared/game-stage";
import { WRITE_GAME_DOC_TOOL } from "../../../shared/game-stage";
import {
  computeAskModeTools,
  computePlanModeTools,
} from "../session-mode/plan-tools";

/** Godot tools auto-enabled during the prototype stage. */
export const PROTOTYPE_GODOT_TOOLS = [
  "godot_editor_info",
  "godot_open_scenes",
  "godot_edited_scene",
  "godot_open_scene",
  "godot_reload_scene",
  "godot_run_scene",
  "godot_run_main_scene",
  "godot_stop_scene",
  "godot_play_errors",
  "godot_get_scene_tree",
  "godot_get_node_properties",
  "godot_import_resources",
] as const;

/** Stages that get the full Godot editor RPC toolset automatically. */
const FULL_GODOT_STAGES = new Set<GameStage>(["testing", "expansion"]);

/** Planning keeps file edits closed and only exposes plan + design-doc writing. */
export function isPlanningStage(stage: GameStage | null | undefined): boolean {
  return stage === "planning";
}

/** Whether this godot tool should be allowed by the stage even if prefs.tools lacks it. */
export function isStageAutoGodotTool(
  stage: GameStage | null | undefined,
  toolName: string,
): boolean {
  if (!stage) return false;
  if (FULL_GODOT_STAGES.has(stage)) {
    return (GODOT_TOOLS as readonly string[]).includes(toolName);
  }
  if (stage === "prototype") {
    return (PROTOTYPE_GODOT_TOOLS as readonly string[]).includes(toolName);
  }
  return false;
}

/** Planning stage active tool set: Plan read-only core + write_plan + write_game_doc. */
export function computePlanningStageTools(
  prefsTools: readonly string[],
): string[] {
  const tools = [...computePlanModeTools(prefsTools)];
  if (!tools.includes(WRITE_GAME_DOC_TOOL)) tools.push(WRITE_GAME_DOC_TOOL);
  return tools;
}

/**
 * Full stage-aware tool list for a session mode.
 *
 * - Ask always stays read-only.
 * - Plan always stays read-only (+ write_plan), but planning also gets write_game_doc.
 * - Agent/Goal keeps prefs tools as the base and widens for the active stage.
 */
export function computeModeToolsWithStage(
  stage: GameStage | null,
  mode: AgentSessionMode,
  prefsTools: readonly string[],
): string[] {
  if (mode === "ask") return computeAskModeTools(prefsTools);
  if (mode === "plan") {
    if (stage === "planning") return computePlanningStageTools(prefsTools);
    return computePlanModeTools(prefsTools);
  }

  // Agent / Goal
  const base = [...prefsTools];
  if (!stage) return base;
  if (stage === "planning") {
    // Even if the user manually switches to Agent inside the planning stage,
    // keep the planning toolset closed and focused on design artifacts.
    return computePlanningStageTools(prefsTools);
  }
  if (FULL_GODOT_STAGES.has(stage)) {
    for (const tool of GODOT_TOOLS) {
      if (!base.includes(tool)) base.push(tool);
    }
  } else if (stage === "prototype") {
    for (const tool of PROTOTYPE_GODOT_TOOLS) {
      if (!base.includes(tool)) base.push(tool);
    }
  }
  return base;
}
