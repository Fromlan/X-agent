/**
 * X-agent ↔ Godot Editor RPC protocol — barrel.
 *
 * 2026-08-31 收口 (issue #60 主题 D C-302): 原 349 行三合一文件拆出
 *   - 协议层 (常量 + 类型)  → ./godot-rpc/protocol.ts
 *   - 白名单 + 工具开关映射  → ./godot-rpc/gating.ts
 *   - 策略层 (clamp / timeout) → ./godot-rpc/policy.ts
 *
 * 本文件剩 ~25 行 barrel re-export, 老的 import 路径
 * (`import { ... } from "@shared/godot-rpc"`) 不用改.
 *
 * Wire format: one JSON object per line (`\n`-delimited).
 *   - Request:  `{ id, method, ...params }`
 *   - Response: `{ id, ok: true, result }` | `{ id, ok: false, error }`
 *   - Event:    `{ type, ... }` (no `id`)
 *
 * Desktop (`GodotRpcBridge`) hosts a TCP JSON-lines server on 127.0.0.1.
 * The Godot addon (`packages/godot-editor-rpc`) is the client.
 */

export {
  // protocol
  GODOT_RPC_DEFAULT_PORT,
  GODOT_RPC_FALLBACK_PORT_END,
  GODOT_RPC_DEFAULT_WAIT_MS,
  GODOT_RPC_MAX_WAIT_MS,
  GODOT_RPC_BASE_TIMEOUT_MS,
  GODOT_RPC_EXPORT_TIMEOUT_MS,
  GODOT_RPC_EXPORT_GRACE_MS,
  GODOT_RPC_GRACE_PERIOD_MS,
  type GodotRpcClientInfo,
  type GodotFileKind,
  type GodotInspectMember,
  type GodotExportTemplatesStatus,
  type GodotRpcCall,
  type GodotRpcRequest,
  type GodotRpcResponse,
  type GodotRpcEvent,
  type GodotRpcHandshakeFailure,
  type GodotRpcBridgeStatus,
  type GodotRpcRequestOptions,
} from "./godot-rpc/protocol";

export {
  // gating
  GODOT_RPC_ALLOWED_METHODS,
  GODOT_RPC_METHOD_TOOL,
  isAllowedGodotRpcMethod,
  godotRpcMethodTool,
  type GodotRpcMethodName,
} from "./godot-rpc/gating";

export {
  // policy
  clampGodotRunWaitMs,
  clampGodotWaitMs,
  clampGodotListLimit,
  godotRpcTimeoutMs,
  GODOT_LIST_FILES_DEFAULT_LIMIT,
  GODOT_LIST_FILES_MAX_LIMIT,
  GODOT_WAIT_DEFAULT_TIMEOUT_MS,
  GODOT_WAIT_MAX_TIMEOUT_MS,
} from "./godot-rpc/policy";
