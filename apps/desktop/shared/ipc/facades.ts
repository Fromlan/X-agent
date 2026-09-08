/**
 * shared/ipc 子模块 — facade 层 (issue #60 主题 D C-301).
 *
 * 9 个 facade 类型 + XAgentApi 全表面 + DELETED_FLAT_KEYS 列表.
 *
 * 真正的定义在 ./../ipc-invoke-map.ts (已经 2026-08-31 拆出), 这里
 * 做 re-export, 让 shared/ipc 子目录有 layout, 老的 import 路径
 * (`import { WorkspaceApi } from "@shared/ipc"`) 走 barrel 仍能找到.
 */
export {
  type WorkspaceApi,
  type TurnApi,
  type PlanApi,
  type SessionApi,
  type PrefsApi,
  type AppReportApi,
  type LogoApi,
  type GodotApi,
  type UpdatesApi,
  type XAgentApiFlat,
  type XAgentApi,
  type DeletedFlatKey,
  type SenderUntrustedError,
  type IpcInvokeResult,
  DELETED_FLAT_KEYS,
  isSenderUntrustedError,
} from "../ipc-invoke-map";
