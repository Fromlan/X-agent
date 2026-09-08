/**
 * shared/godot-rpc 子模块 — 白名单 + 工具开关门控 (issue #60 主题 D C-302).
 *
 * - GODOT_RPC_ALLOWED_METHODS — 协议层允许的方法名白名单 (renderer /
 *   tools 调 godotRpcRequest 时强制通过 type guard)
 * - isAllowedGodotRpcMethod — type guard
 * - GODOT_RPC_METHOD_TOOL — 协议 method → settings tool name 映射
 *   (`godotRpcRequest` 闸在 IPC handler 层: 未勾对应 tool 就拒)
 * - godotRpcMethodTool — 上面 map 的查表 helper
 *
 * policy (clamp / timeout) 在 ./policy.ts, 协议类型在 ./protocol.ts.
 *
 * 跨文件 drift 测试在 ./gating.test.ts (C-306 配套) 校验
 * godot-tools.ts / godot-helpers.ts 的方法名集合与这里一致.
 */

/** Methods the renderer / tools may invoke over Godot RPC. */
export const GODOT_RPC_ALLOWED_METHODS = [
  "ping",
  "get_editor_info",
  "get_open_scenes",
  "get_edited_scene",
  "open_scene",
  "reload_scene",
  "get_scene_tree",
  "get_node_properties",
  "run_current_scene",
  "play_main_scene",
  "import_resources",
  "get_play_errors",
  "stop_scene",
  // 1.2 扩展：调试器 / 资源治理 / 导出 / 配置读写 / lint
  "get_debugger_state",
  "set_breakpoint",
  "find_unused_resources",
  "export_project",
  "get_project_setting",
  "set_project_setting",
  "lint_scripts",
  // 1.3 扩展：只读文件内省 / UID / 类名 / 脚本反射 / 导出预检
  "list_project_files",
  "resolve_uid",
  "wait_for_import_done",
  "list_global_classes",
  "find_class_name_conflicts",
  "inspect_script",
  "list_export_presets",
  "check_export_templates",
] as const;

export type GodotRpcMethodName = (typeof GODOT_RPC_ALLOWED_METHODS)[number];

export function isAllowedGodotRpcMethod(
  method: unknown,
): method is GodotRpcMethodName {
  return (
    typeof method === "string" &&
    (GODOT_RPC_ALLOWED_METHODS as readonly string[]).includes(method)
  );
}

/**
 * RPC method → settings tool name that gates it in `prefs.tools`
 * (GODOT_TOOLS 默认关闭；未勾选时经 godotRpcRequest 的调用必须被拒绝）。
 * `null` = ungated (protocol-level calls like `ping`).
 */
export const GODOT_RPC_METHOD_TOOL: Record<string, string | null> = {
  ping: null,
  get_editor_info: "godot_editor_info",
  get_open_scenes: "godot_open_scenes",
  get_edited_scene: "godot_edited_scene",
  open_scene: "godot_open_scene",
  reload_scene: "godot_reload_scene",
  get_scene_tree: "godot_get_scene_tree",
  get_node_properties: "godot_get_node_properties",
  run_current_scene: "godot_run_scene",
  play_main_scene: "godot_run_main_scene",
  import_resources: "godot_import_resources",
  get_play_errors: "godot_play_errors",
  stop_scene: "godot_stop_scene",
  get_debugger_state: "godot_get_debugger_state",
  set_breakpoint: "godot_set_breakpoint",
  find_unused_resources: "godot_find_unused_resources",
  export_project: "godot_export_project",
  get_project_setting: "godot_get_project_setting",
  set_project_setting: "godot_set_project_setting",
  lint_scripts: "godot_lint_scripts",
  list_project_files: "godot_list_project_files",
  resolve_uid: "godot_resolve_uid",
  wait_for_import_done: "godot_wait_for_import_done",
  list_global_classes: "godot_list_global_classes",
  find_class_name_conflicts: "godot_find_class_name_conflicts",
  inspect_script: "godot_inspect_script",
  list_export_presets: "godot_list_export_presets",
  check_export_templates: "godot_check_export_templates",
};

/** Tool name required by `prefs.tools` for an RPC method, or null if ungated. */
export function godotRpcMethodTool(method: string): string | null {
  return GODOT_RPC_METHOD_TOOL[method] ?? null;
}
