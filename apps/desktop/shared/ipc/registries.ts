/**
 * shared/ipc 子模块 — 工具注册表 (issue #60 主题 D C-306).
 *
 * 工具注册表的 source-of-truth 与 derive 拆到 ./../tools/*:
 *   - ./../tools/available.ts — AVAILABLE_TOOLS / BuiltinToolName
 *   - ./../tools/godot.ts    — GODOT_TOOLS / GodotToolName
 *   - ./../tools/derived.ts  — ALL_TOGGLEABLE_TOOLS / SESSION_TOOL_REGISTRY
 *                             (用 deriveToolList 在 load-time 去重)
 *
 * 这里只做 barrel re-export. 老的 import 路径
 * `import { AVAILABLE_TOOLS } from "@shared/ipc"` 走 ./ipc.ts barrel 仍能找到.
 */
export {
  AVAILABLE_TOOLS,
  type BuiltinToolName,
} from "../tools/available";
export {
  GODOT_TOOLS,
  type GodotToolName,
} from "../tools/godot";
export {
  ALL_TOGGLEABLE_TOOLS,
  SESSION_TOOL_REGISTRY,
} from "../tools/derived";
