/**
 * Stage-aware tool whitelist computation.
 *
 * The active tool list is the union of (existing mode-derived tools) and
 * (stage additions). Read-only session modes (ask / plan) keep the existing
 * readonly core; agent / goal modes get stage-driven Godot additions.
 *
 * Design (策划) stage is special: even if the user is in agent mode inside
 * the design stage, the whitelist is narrowed to plan-mode tools so the
 * agent cannot accidentally mutate game code.
 */
import type { AgentSessionMode } from "./ipc";
import { GODOT_TOOLS } from "./ipc";
import { STAGE_DEFINITIONS } from "./stage-defs";
import type { StageId, StageToolPreset } from "./stage";
import {
  PLAN_MODE_OPTIONAL_READONLY_TOOLS,
  PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS,
  READONLY_CORE_TOOLS,
} from "./mode-tools";

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
  "godot_get_project_setting",
  "godot_set_project_setting",
  "godot_wait_for_import_done",
] as const;

/** Godot tools auto-enabled during the test / debug stage. */
export const TEST_GODOT_TOOLS = [
  "godot_editor_info",
  "godot_open_scenes",
  "godot_edited_scene",
  "godot_play_errors",
  "godot_stop_scene",
  "godot_get_debugger_state",
  "godot_set_breakpoint",
  "godot_get_scene_tree",
  "godot_get_node_properties",
  "godot_lint_scripts",
  "godot_list_project_files",
  "godot_resolve_uid",
  "godot_inspect_script",
  "godot_run_scene",
  "godot_run_main_scene",
  "godot_find_unused_resources",
] as const;

/** Stages that get the full Godot editor RPC toolset automatically. */
const FULL_GODOT_STAGES = new Set<StageId>(["test", "expand"]);

/** True when the design stage wants the planning-style toolset. */
export function isDesignStage(stage: StageId | null | undefined): boolean {
  return stage === "design";
}

/** True when a Godot tool should be allowed by the stage even if prefs lacks it. */
export function isStageAutoGodotTool(
  stage: StageId | null | undefined,
  toolName: string,
): boolean {
  if (!stage) return false;
  if (FULL_GODOT_STAGES.has(stage)) {
    return (GODOT_TOOLS as readonly string[]).includes(toolName);
  }
  if (stage === "prototype") {
    return (PROTOTYPE_GODOT_TOOLS as readonly string[]).includes(toolName);
  }
  if (stage === "test") {
    return (TEST_GODOT_TOOLS as readonly string[]).includes(toolName);
  }
  return false;
}

/** Internal: optional readonly tools (prefs-conditional) for ask / plan modes. */
function appendOptionalReadonlyGodotTools(
  tools: string[],
  prefsTools: readonly string[],
): void {
  const prefs = new Set(prefsTools);
  for (const name of PLAN_MODE_OPTIONAL_READONLY_TOOLS) {
    if (prefs.has(name)) tools.push(name);
  }
  // 扩展工具由 godot-pi Package 注册到 Pi 扩展运行时,默认放行。
  tools.push(...PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS);
}

/** Ask mode tool list — mirrors computeAskModeTools in plan-tools.ts. */
function computeAskModeTools(prefsTools: readonly string[]): string[] {
  const tools: string[] = [...READONLY_CORE_TOOLS];
  appendOptionalReadonlyGodotTools(tools, prefsTools);
  return tools;
}

/** Plan mode tool list — mirrors computePlanModeTools in plan-tools.ts. */
function computePlanModeTools(prefsTools: readonly string[]): string[] {
  const tools: string[] = [...READONLY_CORE_TOOLS, "write_plan"];
  appendOptionalReadonlyGodotTools(tools, prefsTools);
  return tools;
}

/**
 * Compute the active tool list for a (stage, mode, prefs) triple.
 *
 * Algorithm:
 * - ask mode always stays read-only.
 * - plan mode stays read-only (+ write_plan).
 * - agent / goal mode in design stage is forced to plan-mode tools
 *   (preventing accidental game code mutation).
 * - agent / goal mode in prototype / test / expand gets prefs tools as the
 *   base plus stage-driven Godot additions.
 */
export function computeStageTools(
  stage: StageId | null,
  mode: AgentSessionMode,
  prefsTools: readonly string[],
): string[] {
  if (mode === "ask") {
    return computeAskModeTools(prefsTools);
  }
  if (mode === "plan") {
    return computePlanModeTools(prefsTools);
  }
  // agent / goal
  if (isDesignStage(stage)) {
    return computePlanModeTools(prefsTools);
  }
  const base = new Set<string>(prefsTools);
  if (!stage) return [...base];
  if (FULL_GODOT_STAGES.has(stage)) {
    for (const tool of GODOT_TOOLS) base.add(tool);
  } else if (stage === "prototype") {
    for (const tool of PROTOTYPE_GODOT_TOOLS) base.add(tool);
  } else if (stage === "test") {
    for (const tool of TEST_GODOT_TOOLS) base.add(tool);
  }
  return [...base];
}

/** Read the tool preset from STAGE_DEFINITIONS (defensive: empty fallback). */
export function presetForStage(stage: StageId | null | undefined): StageToolPreset {
  if (!stage) return "full";
  return STAGE_DEFINITIONS[stage]?.toolPreset ?? "full";
}
