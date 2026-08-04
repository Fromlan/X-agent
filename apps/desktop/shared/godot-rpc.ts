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
  | { method: "stop_scene" };

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

/** RPC timeout for a call (play wait + base timeout for play methods). */
export function godotRpcTimeoutMs(call: GodotRpcCall): number {
  if (isPlayWaitMethod(call.method)) {
    const wait =
      "wait_ms" in call ? clampGodotRunWaitMs(call.wait_ms) : GODOT_RPC_DEFAULT_WAIT_MS;
    return wait + GODOT_RPC_BASE_TIMEOUT_MS;
  }
  // Resource import / filesystem scan can be slow on large projects.
  if (call.method === "import_resources") {
    return GODOT_RPC_BASE_TIMEOUT_MS * 4;
  }
  return GODOT_RPC_BASE_TIMEOUT_MS;
}
