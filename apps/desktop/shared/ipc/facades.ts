/**
 * shared/ipc 子模块 — facade 层 (issue #60 主题 D C-301, #2 flat-API 收尾).
 *
 * 14 facade 类型 + XAgentApi 全表面 (无 flat 表面). 真正的定义在
 * ./../ipc-invoke-map.ts (已经 2026-08-31 拆出), 这里做 re-export, 让
 * shared/ipc 子目录有 layout, 老的 import 路径
 * (`import { WorkspaceApi } from "@shared/ipc"`) 走 barrel 仍能找到.
 *
 * 2026-09-08 issue #2: 删 XAgentApiFlat / FlatInvokeApi / DELETED_FLAT_KEYS /
 * DeletedFlatKey. 渲染端必须走 facade 调用, flat surface 已彻底删除.
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
  type FilesApi,
  type ProviderApi,
  type PluginApi,
  type PackageApi,
  type UsageApi,
  type XAgentApi,
  type SenderUntrustedError,
  type IpcInvokeResult,
  isSenderUntrustedError,
} from "../ipc-invoke-map";
