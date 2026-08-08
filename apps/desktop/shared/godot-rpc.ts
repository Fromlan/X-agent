/**
 * X-agent ↔ Godot Editor RPC protocol.
 *
 * Desktop (`GodotRpcBridge`) hosts a TCP JSON-lines server on 127.0.0.1.
 * The Godot addon (`packages/godot-editor-rpc`) is the client.
 *
 * Wire format: one JSON object per line (`\n`-delimited).
 * - Request: `{ id, method, ...params }`
 * - Response: `{ id, ok: true, result }` | `{ id, ok: false, error }`
 * - Event: `{ type, ... }` (no `id`)
 */

export const GODOT_RPC_DEFAULT_PORT = 8765;

/** Default collection window after play scene methods. */
export const GODOT_RPC_DEFAULT_WAIT_MS = 3000;

/** Upper bound for `wait_ms` (plugin + tools clamp to this). */
export const GODOT_RPC_MAX_WAIT_MS = 15000;

/** Base RPC round-trip timeout (excluding play wait window). */
export const GODOT_RPC_BASE_TIMEOUT_MS = 8000;

/**
 * 项目导出的最长等待时间。
 * `export_project` 走 Godot 子进程 `--headless --export-release`，大项目出包可达数分钟。
 */
export const GODOT_RPC_EXPORT_TIMEOUT_MS = 5 * 60_000;

/**
 * 桥接启动后的重连宽限期。
 * 期间就绪清单不提示「未连接」，留给已在运行的 Godot 插件完成重连。
 */
export const GODOT_RPC_GRACE_PERIOD_MS = 8000;

/** Connected Godot editor client (bridge-assigned id). */
export interface GodotRpcClientInfo {
  id: string;
  projectPath?: string;
  godotVersion?: string;
  /** Addon version from plugin.cfg (0.3.0+ only). */
  addonVersion?: string;
  connectedAt: string;
}

/** 1.3：只读内省、UID 与导出预检 工具的请求类型。 */
export type GodotFileKind =
  | "scene"
  | "script"
  | "shader"
  | "resource"
  | "texture"
  | "audio"
  | "other";

export type GodotInspectMember = {
  name: string;
  type?: string;
  /** godot 返回的 raw hint 字段，可能含 enum/flag/usage 等信息。 */
  hint?: string;
};

export type GodotInspectResult = {
  path: string;
  base?: string;
  extends?: string;
  signals: GodotInspectMember[];
  methods: GodotInspectMember[];
  properties: GodotInspectMember[];
  constants: GodotInspectMember[];
};

export type GodotFileEntry = {
  path: string;
  /** res:// 路径（与 path 同）。 */
  type: GodotFileKind | string;
  uid?: string;
};

export type GodotExportPreset = {
  name: string;
  platform: string;
  index: number;
};

export type GodotExportTemplatesStatus = {
  installed: boolean;
  /** 当前 Godot 版本。 */
  version?: string;
  /** 已安装的模板版本（不一定与 current 一致）。 */
  templateVersion?: string;
  missingPlatforms: string[];
};

/** Call payload without correlation id (desktop assigns id). */
export type GodotRpcCall =
  | { method: "ping" }
  | { method: "get_editor_info" }
  | { method: "get_open_scenes" }
  | { method: "get_edited_scene" }
  | { method: "open_scene"; path: string }
  | { method: "reload_scene"; path: string }
  | { method: "get_scene_tree"; path: string; max_depth?: number }
  | { method: "get_node_properties"; path: string; node_path: string }
  | { method: "run_current_scene"; wait_ms?: number }
  | { method: "play_main_scene"; wait_ms?: number }
  | { method: "import_resources"; paths?: string[] }
  | { method: "get_play_errors"; clear?: boolean }
  | { method: "stop_scene" }
  // 1.2 扩展：调试器 / 资源治理 / 导出 / 配置读写 / lint
  | { method: "get_debugger_state" }
  | { method: "set_breakpoint"; file: string; line: number; condition?: string; remove?: boolean }
  | { method: "find_unused_resources"; root?: string }
  | { method: "export_project"; preset: string; output_dir: string; debug?: boolean }
  | { method: "get_project_setting"; key: string }
  | { method: "set_project_setting"; key: string; value: unknown }
  | { method: "lint_scripts"; paths: string[] }
  // 1.3 扩展：只读文件内省 / UID / 类名 / 脚本反射 / 导出预检
  | {
      method: "list_project_files";
      root?: string;
      type?: string;
      pattern?: string;
      limit?: number;
      cursor?: string;
    }
  | { method: "resolve_uid"; uid?: string; path?: string }
  | { method: "wait_for_import_done"; paths: string[]; timeout_ms?: number }
  | { method: "list_global_classes" }
  | { method: "find_class_name_conflicts"; include_addons?: boolean }
  | { method: "inspect_script"; path: string }
  | { method: "list_export_presets" }
  | { method: "check_export_templates" };

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

export type GodotRpcRequest = GodotRpcCall & { id: string };

export type GodotRpcResponse =
  | {
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      id: string;
      ok: false;
      error: string;
    };

export type GodotRpcEvent =
  | {
      type: "editor_ready";
      godotVersion: string;
      projectPath: string;
      /** Shared secret from x-agent-godot-rpc.json (required by bridge). */
      token?: string;
      /** Addon version from plugin.cfg (reported by 0.3.0+ only). */
      addonVersion?: string;
      clientId?: string;
    }
  | { type: "scene_changed"; path: string; clientId?: string }
  | { type: "play_error"; severity: string; message: string; clientId?: string }
  | { type: "disconnected"; clientId?: string };

/** 握手失败原因，用于就绪清单区分「插件过旧」与「token 不匹配」。 */
export type GodotRpcHandshakeFailure = "missing_token" | "bad_token";

export interface GodotRpcBridgeStatus {
  running: boolean;
  port: number;
  /**
   * 已建立的 TCP 连接数（含尚未通过 token 握手的裸 socket）。
   * 判断「真正连上了」请用 `authenticatedClients`。
   */
  clients: number;
  /** Connected editors with bridge-assigned ids. */
  clientInfos: GodotRpcClientInfo[];
  /** Preferred client for routed requests (null → first connected). */
  activeClientId: string | null;
  lastEvent?: GodotRpcEvent;
  /** Set when the last start attempt failed (e.g. all ports busy). */
  error?: string;
  /** Non-fatal note (e.g. fell back to another port). */
  warning?: string;
  /** 桥接最近一次成功 start 的 Unix ms；renderer 据此计算重连宽限期。 */
  startedAt?: number;
  /** 已通过 token 握手的客户端数。 */
  authenticatedClients?: number;
  /** 自上次 start 以来的握手失败累计次数。 */
  handshakeFailures?: number;
  /** 最近一次握手失败原因。 */
  lastHandshakeFailure?: GodotRpcHandshakeFailure;
  /** 最近一次成功握手上报的插件版本（0.3.0+ 才会上报）。 */
  lastAddonVersion?: string;
}

export type GodotRpcRequestOptions = {
  /** Route to a specific editor client; defaults to activeClientId / first client. */
  clientId?: string | null;
};

/** Clamp `wait_ms` for play scene methods (default 3000, max 15000). */
export function clampGodotRunWaitMs(raw: unknown): number {
  // 负数视为非法 → 回退默认收集窗口（0 保留 = 不等待）。
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.min(GODOT_RPC_MAX_WAIT_MS, Math.floor(raw));
  }
  return GODOT_RPC_DEFAULT_WAIT_MS;
}

function isPlayWaitMethod(method: string): boolean {
  return method === "run_current_scene" || method === "play_main_scene";
}

/** 1.3：list_project_files 默认上限，避免 Agent 一次性吞下整个项目树。 */
export const GODOT_LIST_FILES_DEFAULT_LIMIT = 500;
/** 1.3：list_project_files / wait_for_import_done 上限，防止 Tool 描述被巨大参数撑爆。 */
export const GODOT_LIST_FILES_MAX_LIMIT = 5000;
/** 1.3：wait_for_import_done / wait_for_break 默认等待时长（ms）。 */
export const GODOT_WAIT_DEFAULT_TIMEOUT_MS = 30_000;
/** 1.3：wait_for_import_done / wait_for_break 最长允许等待（ms）。 */
export const GODOT_WAIT_MAX_TIMEOUT_MS = 60_000;

/** 钳制 wait_for_import_done / wait_for_break 的 timeout_ms。 */
export function clampGodotWaitMs(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.min(GODOT_WAIT_MAX_TIMEOUT_MS, Math.floor(raw));
  }
  return GODOT_WAIT_DEFAULT_TIMEOUT_MS;
}

/** 钳制 list_project_files 的 limit。 */
export function clampGodotListLimit(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.min(GODOT_LIST_FILES_MAX_LIMIT, Math.floor(raw));
  }
  return GODOT_LIST_FILES_DEFAULT_LIMIT;
}

/** RPC timeout for a call (play wait + base timeout for play methods). */
export function godotRpcTimeoutMs(call: GodotRpcCall): number {
  if (isPlayWaitMethod(call.method)) {
    const wait =
      "wait_ms" in call ? clampGodotRunWaitMs(call.wait_ms) : GODOT_RPC_DEFAULT_WAIT_MS;
    return wait + GODOT_RPC_BASE_TIMEOUT_MS;
  }
  // 项目导出走 Godot 子进程出包，最慢档（5 分钟）。
  if (call.method === "export_project") {
    return GODOT_RPC_EXPORT_TIMEOUT_MS;
  }
  // wait_for_import_done：用户窗口 + 1s 基线（wait_for_break 同模式，待 1.3 调试回路 PR 启用）。
  if (call.method === "wait_for_import_done") {
    const wait =
      "timeout_ms" in call
        ? clampGodotWaitMs(call.timeout_ms)
        : GODOT_WAIT_DEFAULT_TIMEOUT_MS;
    return wait + GODOT_RPC_BASE_TIMEOUT_MS;
  }
  // 资源导入 / 全项目扫描 / 批量脚本解析可能较慢。
  if (
    call.method === "import_resources" ||
    call.method === "find_unused_resources" ||
    call.method === "lint_scripts" ||
    call.method === "list_project_files" ||
    call.method === "inspect_script" ||
    call.method === "find_class_name_conflicts"
  ) {
    return GODOT_RPC_BASE_TIMEOUT_MS * 4;
  }
  return GODOT_RPC_BASE_TIMEOUT_MS;
}
