/**
 * Design session type tool preset.
 *
 * A Design session reads any project file but only writes to
 * <cwd>/game-design/. The base toolset is read-only (so the agent can also
 * navigate code as a planning reference) plus write/edit (routed by the
 * design-write-guard extension). We do NOT include write_plan — design
 * documents live in <cwd>/game-design/ as plain markdown, not in
 * ~/.pi/agent/x-agent/plans/.
 *
 * For Godot tools, only readonly variants are allowed. Optional readonly
 * tools (PLAN_MODE_OPTIONAL_READONLY_TOOLS) are merged from prefs if the
 * user has enabled them.
 *
 * Type-level decisions are now centralized in `electron/agent/session-type-policy.ts`.
 * This file remains as the source of truth for the raw tool list (DESIGN_SESSION_TYPE_TOOLS)
 * and the per-type compute functions; the convenience computeSessionTypeTools
 * delegates to the policy factory so callers can keep using the simple (type, prefs)
 * signature.
 */
import {
  PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS,
  PLAN_MODE_OPTIONAL_READONLY_TOOLS,
  READONLY_CORE_TOOLS,
} from "./mode-tools";
import type { SessionType } from "./session-type";

/**
 * Edit-class tools the design-write-guard lets through (after path check).
 * These are Pi built-ins (registered in SESSION_TOOL_REGISTRY) that we want
 * the agent to be able to call inside a Design session — the guard decides
 * whether the path argument is inside game-design/.
 */
const DESIGN_WRITE_TOOLS = ["write", "edit"] as const;

/**
 * The base tool set for any Design session (before mode is applied).
 * Mode (ask/plan/agent/goal) only narrows further; the guard is the
 * authoritative constraint on what may actually mutate disk.
 */
export const DESIGN_SESSION_TYPE_TOOLS: readonly string[] = [
  ...READONLY_CORE_TOOLS, // read / grep / find / ls / bash
  ...DESIGN_WRITE_TOOLS, // write / edit — guard-gated
  // 同 plan mode 一样加 readonly Godot extension
  ...PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS, // godot_detect_project
];

export function computeDesignSessionTypeTools(
  prefsTools: readonly string[],
): string[] {
  const tools: string[] = [...DESIGN_SESSION_TYPE_TOOLS];
  // 用户在 prefs 启用的额外 readonly Godot 工具, 保留
  const prefs = new Set(prefsTools);
  for (const t of PLAN_MODE_OPTIONAL_READONLY_TOOLS) {
    if (prefs.has(t) && !tools.includes(t)) tools.push(t);
  }
  return tools;
}

/**
 * Code session type tool set: this is just prefs.tools. The mode controller
 * may narrow further (ask/plan → readonly subset), but the type itself adds
 * no constraint.
 */
export function computeCodeSessionTypeTools(
  prefsTools: readonly string[],
): string[] {
  return [...prefsTools];
}

/**
 * Convenience accessor — delegates to a transient CodePolicy / DesignPolicy.
 * The factory is the **only** place that maps a SessionType to behavior.
 * New code should call `createSessionTypePolicy(type).toolPreset(prefsTools)`
 * directly to keep policy creation in one place.
 */
export function computeSessionTypeTools(
  sessionType: SessionType,
  prefsTools: readonly string[],
): string[] {
  // Note: this function intentionally stays in shared/ (it has no Electron
  // dependency). It inlines the same dispatch as the policy factory. Keep
  // the two in sync — see session-type-policy.ts:POLICIES.
  return sessionType === "design"
    ? computeDesignSessionTypeTools(prefsTools)
    : computeCodeSessionTypeTools(prefsTools);
}
