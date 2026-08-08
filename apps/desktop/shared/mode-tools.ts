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
  // 1.0：纯只读内省
  "godot_open_scenes",
  "godot_edited_scene",
  "godot_play_errors",
  // 1.2 扩展：场景树 / 节点属性 / 调试器状态 / 资源治理 / 配置读取 / lint 只读工具
  "godot_get_scene_tree",
  "godot_get_node_properties",
  "godot_get_debugger_state",
  "godot_find_unused_resources",
  "godot_get_project_setting",
  "godot_lint_scripts",
  // 1.3 扩展：只读文件内省 / UID / 类名 / 脚本反射 / 导出预检（C3）
  "godot_list_project_files",
  "godot_resolve_uid",
  "godot_list_global_classes",
  "godot_find_class_name_conflicts",
  "godot_inspect_script",
  "godot_list_export_presets",
  "godot_check_export_templates",
] as const;

/**
 * 只读 Pi 扩展工具 —— 不走 prefs 开关、由 godot-pi Package 注册到 Pi 扩展运行时，
 * 只要该 Package 装入就常驻。Plan / Ask 模式默认放行（纯读取，不改任何文件），
 * 不与 PLAN_MODE_OPTIONAL_READONLY_TOOLS 混在一起：后者要求用户在设置中勾选才放行。
 */
export const PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS = [
  "godot_detect_project",
] as const;
