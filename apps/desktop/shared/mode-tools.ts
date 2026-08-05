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
  // 1.2 扩展：场景树 / 节点属性 / 调试器状态 / 资源治理 / 配置读取 / lint 只读工具
  "godot_get_scene_tree",
  "godot_get_node_properties",
  "godot_get_debugger_state",
  "godot_find_unused_resources",
  "godot_get_project_setting",
  "godot_lint_scripts",
] as const;
