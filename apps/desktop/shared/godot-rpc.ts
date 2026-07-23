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

/** Default collection window after `run_current_scene` / `godot_run_scene`. */
export const GODOT_RPC_DEFAULT_WAIT_MS = 3000;

/** Upper bound for `wait_ms` (plugin + tools clamp to this). */
export const GODOT_RPC_MAX_WAIT_MS = 15000;

/** Base RPC round-trip timeout (excluding play wait window). */
export const GODOT_RPC_BASE_TIMEOUT_MS = 8000;

/** Call payload without correlation id (desktop assigns id). */
export type GodotRpcCall =
  | { method: "ping" }
  | { method: "get_editor_info" }
  | { method: "get_open_scenes" }
  | { method: "get_edited_scene" }
  | { method: "open_scene"; path: string }
  | { method: "reload_scene"; path: string }
  | { method: "run_current_scene"; wait_ms?: number }
  | { method: "get_play_errors"; clear?: boolean }
  | { method: "stop_scene" };

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
  | { type: "editor_ready"; godotVersion: string; projectPath: string }
  | { type: "scene_changed"; path: string }
  | { type: "play_error"; severity: string; message: string }
  | { type: "disconnected" };

export interface GodotRpcBridgeStatus {
  running: boolean;
  port: number;
  clients: number;
  lastEvent?: GodotRpcEvent;
  /** Set when the last start attempt failed (e.g. all ports busy). */
  error?: string;
  /** Non-fatal note (e.g. fell back to another port). */
  warning?: string;
}

/** Clamp `wait_ms` for `run_current_scene` (default 3000, max 15000). */
export function clampGodotRunWaitMs(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(GODOT_RPC_MAX_WAIT_MS, Math.floor(raw)));
  }
  return GODOT_RPC_DEFAULT_WAIT_MS;
}

/** RPC timeout for a call (play wait + base timeout for `run_current_scene`). */
export function godotRpcTimeoutMs(call: GodotRpcCall): number {
  if (call.method === "run_current_scene") {
    return clampGodotRunWaitMs(call.wait_ms) + GODOT_RPC_BASE_TIMEOUT_MS;
  }
  return GODOT_RPC_BASE_TIMEOUT_MS;
}
