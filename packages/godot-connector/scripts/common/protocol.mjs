/**
 * Godot RPC protocol constants shared by the bridge, the MCP server, and the
 * SessionStart hook.  Values mirror `apps/desktop/shared/godot-rpc.ts` so the
 * GDScript addon can connect without any change.
 */

export const GODOT_RPC_DEFAULT_PORT = 8765;
export const GODOT_RPC_FALLBACK_PORT_END = 8774;
export const GODOT_RPC_BASE_TIMEOUT_MS = 8_000;
export const GODOT_RPC_DEFAULT_WAIT_MS = 3_000;
export const GODOT_RPC_MAX_WAIT_MS = 15_000;
export const GODOT_RPC_EXPORT_TIMEOUT_MS = 5 * 60_000;
export const GODOT_RPC_EXPORT_GRACE_MS = 15_000;
export const GODOT_RPC_GRACE_PERIOD_MS = 8_000;
export const ENDPOINT_FILE_VERSION = 1;
export const ENDPOINT_TOKEN_RE = /^[0-9a-f]{32}$/i;
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
export const FALLBACK_PORT_COUNT = 9; // preferred + 9 → 10 attempts

/**
 * All RPC method names that the bridge is allowed to forward.
 * Update this list when the addon adds new methods.
 */
export const GODOT_RPC_ALLOWED_METHODS = Object.freeze([
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
  "get_debugger_state",
  "set_breakpoint",
  "find_unused_resources",
  "export_project",
  "get_project_setting",
  "set_project_setting",
  "lint_scripts",
  "list_project_files",
  "resolve_uid",
  "wait_for_import_done",
  "list_global_classes",
  "find_class_name_conflicts",
  "inspect_script",
  "list_export_presets",
  "check_export_templates",
]);

export function isAllowedGodotRpcMethod(method) {
  return (
    typeof method === "string" &&
    GODOT_RPC_ALLOWED_METHODS.includes(method)
  );
}

/**
 * Returns the MCP tool name that maps to a given RPC method.  Mirrors
 * `GODOT_RPC_METHOD_TOOL` in `apps/desktop/shared/godot-rpc.ts`.
 */
export const GODOT_RPC_METHOD_TOOL = Object.freeze({
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
});

/** Tool name from MCP name → underlying RPC method. */
export function rpcMethodFromToolName(toolName) {
  for (const [method, name] of Object.entries(GODOT_RPC_METHOD_TOOL)) {
    if (name === toolName) return method;
  }
  if (toolName === "godot_ping") return "ping";
  return null;
}

export function toolNameFromRpcMethod(method) {
  return GODOT_RPC_METHOD_TOOL[method] ?? `godot_${method}`;
}

/**
 * Compute the per-call timeout in ms.  `export_project` is allowed to take up
 * to 5 minutes; everything else uses the base timeout plus the optional
 * play wait window.
 */
export function godotRpcTimeoutMs(call) {
  if (call && call.method === "export_project") {
    return GODOT_RPC_EXPORT_TIMEOUT_MS + GODOT_RPC_EXPORT_GRACE_MS;
  }
  if (
    call &&
    (call.method === "run_current_scene" || call.method === "play_main_scene")
  ) {
    const wait = typeof call.wait_ms === "number" ? call.wait_ms : GODOT_RPC_DEFAULT_WAIT_MS;
    return GODOT_RPC_BASE_TIMEOUT_MS + Math.min(wait, GODOT_RPC_MAX_WAIT_MS);
  }
  return GODOT_RPC_BASE_TIMEOUT_MS;
}

/** Clamp a `wait_ms` argument into the allowed range. */
export function clampGodotRunWaitMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return GODOT_RPC_DEFAULT_WAIT_MS;
  if (value < 0) return 0;
  if (value > GODOT_RPC_MAX_WAIT_MS) return GODOT_RPC_MAX_WAIT_MS;
  return value;
}
