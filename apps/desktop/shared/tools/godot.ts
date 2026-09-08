/**
 * Godot editor RPC tool names togglable via `ClientPrefs.tools` (issue #60
 * 涓婚 D C-306).
 *
 * Single source of truth 鈥?every other registry (ALL_TOGGLEABLE_TOOLS,
 * SESSION_TOOL_REGISTRY) derives from this. See ./derive.ts for the
 * dedup contract and ./../godot-rpc/gating.ts for the protocol-method
 * 鈫?settings-tool-name mapping that this list pairs with.
 *
 * Default state: ALL off (opt-in via settings). The renderer ships a
 * one-time nudge that suggests enabling these on Godot projects
 * (see `dismissedGodotToolsNudgeKeys` in `ClientPrefs`).
 *
 * Adding a new RPC tool:
 *   1. add the method to `GodotRpcCall` in shared/godot-rpc/protocol.ts
 *   2. add the entry to `GODOT_RPC_ALLOWED_METHODS` (same file)
 *   3. add the `godot_xxx` name here
 *   4. add the GODOT_RPC_METHOD_TOOL mapping in shared/godot-rpc/gating.ts
 *   5. (optionally) add the tool definition in `electron/agent/godot-tools.ts`
 *
 * Naming convention: MUST start with `godot_` (enforced by ipc.test.ts
 * boundary check). The bridge / addon use the suffix for log tagging.
 */
export const GODOT_TOOLS = [
  "godot_editor_info",
  "godot_open_scenes",
  "godot_edited_scene",
  "godot_open_scene",
  "godot_reload_scene",
  "godot_run_scene",
  "godot_run_main_scene",
  "godot_import_resources",
  "godot_play_errors",
  "godot_stop_scene",
  // 1.2 鎵╁睍锛氬満鏅唴鐪侊紙鍙锛?  "godot_get_scene_tree",
  "godot_get_node_properties",
  // 1.2 鎵╁睍锛氳皟璇曞櫒 / 璧勬簮娌荤悊 / 瀵煎嚭 / 閰嶇疆璇诲啓 / lint
  "godot_get_debugger_state",
  "godot_set_breakpoint",
  "godot_find_unused_resources",
  "godot_export_project",
  "godot_get_project_setting",
  "godot_set_project_setting",
  "godot_lint_scripts",
  // 1.3 鎵╁睍锛氬彧璇绘枃浠跺唴鐪?/ UID / 绫诲悕 / 鑴氭湰鍙嶅皠 / 瀵煎嚭棰勬
  "godot_list_project_files",
  "godot_resolve_uid",
  "godot_wait_for_import_done",
  "godot_list_global_classes",
  "godot_find_class_name_conflicts",
  "godot_inspect_script",
  "godot_list_export_presets",
  "godot_check_export_templates",
] as const;

export type GodotToolName = (typeof GODOT_TOOLS)[number];
