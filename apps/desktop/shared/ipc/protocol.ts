/**
 * shared/ipc 子模块 — 协议层 (issue #60 主题 D C-301, #2 flat-API 收尾).
 *
 * 这里只做 channel-keyed 协议的 re-export:
 *   - IpcInvokeMap — 真正的 invoke 通道签名, 包含 ~100 个 IPC 通道
 *   - IpcChannelKey — IPC_CHANNELS 的 keyof, 编译期保证两边同步
 *   - IpcInvokeResult — 协议层 "Result | SenderUntrustedError" 派生契约
 *     (issue #65 主题 H, 2026-08-31)
 *
 * 真正的协议 + 14 facade 在 ./../ipc-invoke-map.ts (已经 2026-08-31 拆出).
 * 这里只是为了"shared/ipc 子目录有协议层"这个 layout — 老的
 * `import ... from "@shared/ipc"` 走 ./ipc.ts barrel 仍能找到.
 *
 * 2026-09-08 issue #2: 删 FlatInvokeApi re-export (flat surface 已删).
 */
export type { IpcInvokeMap, IpcInvokeResult } from "../ipc-invoke-map";
export type { IpcChannelKey } from "../ipc-channels";
