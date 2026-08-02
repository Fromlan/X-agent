/**
 * Ask / Plan mode tool allowlists (shared with renderer prefs UI).
 */
export const WRITE_PLAN_TOOL = "write_plan" as const;

/** Shared read-only builtins for Ask / Plan modes. */
export const READONLY_CORE_TOOLS = ["read", "grep", "find", "ls", "bash"] as const;

/** Core tools active while in Plan mode (write_plan is a custom tool, not prefs-toggleable). */
export const PLAN_MODE_CORE_TOOLS = [
  ...READONLY_CORE_TOOLS,
  WRITE_PLAN_TOOL,
] as const;

/** Read-only Godot tools allowed in Ask/Plan when already enabled in prefs. */
export const PLAN_MODE_OPTIONAL_READONLY_TOOLS = [
  "godot_editor_info",
] as const;
