/**
 * Shared IPC types between main and renderer.
 *
 * 2026-08-31 收口 (issue #60 主题 D C-301): 原 1300+ 行 god file 拆出
 *   - IpcInvokeMap + 9 facade + XAgentApi + DELETED_FLAT_KEYS
 *     → ./ipc-invoke-map.ts (wave-1 已完成)
 *   - ClientPrefs + ClientPrefsSchema + theme guard
 *     → ./ipc/prefs.ts
 *   - 工具注册表 source-of-truth 与 derive
 *     → ./../tools/* (wave-2 C-306 已完成)
 *   - 纯 DTO 类型 (~800 行)
 *     → ./ipc/types.ts
 *   - 协议 + facade + 注册表 re-export
 *     → ./ipc/{protocol,facades,registries}.ts
 *
 * 本文件只剩 ~50 行 barrel re-export, 老的 ~100 个 consumer import
 * 路径 (`from "@shared/ipc"`) 不用改. 保持 #1 加的 `goalEvaluatorModel`
 * 字段在 ClientPrefs / DEFAULT_PREFS / ClientPrefsSchema 中(三个
 * 子文件都 import 同一个 `ClientPrefs` interface).
 */

// ----- ipc-channels & session-type re-exports -----
export type { IpcChannelKey } from "./ipc-channels";
import type { SessionType } from "./session-type";
export {
  SESSION_TYPES,
  SESSION_TYPE_LABELS,
  DEFAULT_SESSION_TYPE,
  isSessionType,
  coerceSessionType,
} from "./session-type";
export type { SessionType } from "./session-type";

// ----- mode-tools re-exports (WritePlan / PlanMode) -----
export {
  WRITE_PLAN_TOOL,
  READONLY_CORE_TOOLS,
  PLAN_MODE_CORE_TOOLS,
  PLAN_MODE_OPTIONAL_READONLY_TOOLS,
  PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS,
} from "./mode-tools";

// ----- protocol / facades / registries / types / prefs -----
export type {
  IpcInvokeMap,
  FlatInvokeApi,
  IpcInvokeResult,
} from "./ipc/protocol";
export type {
  WorkspaceApi,
  TurnApi,
  PlanApi,
  SessionApi,
  PrefsApi,
  AppReportApi,
  LogoApi,
  GodotApi,
  UpdatesApi,
  XAgentApiFlat,
  XAgentApi,
  DeletedFlatKey,
  SenderUntrustedError,
} from "./ipc/facades";
export {
  DELETED_FLAT_KEYS,
  isSenderUntrustedError,
} from "./ipc/facades";
export {
  AVAILABLE_TOOLS,
  type BuiltinToolName,
  GODOT_TOOLS,
  type GodotToolName,
  ALL_TOGGLEABLE_TOOLS,
  SESSION_TOOL_REGISTRY,
} from "./ipc/registries";
export type {
  AgentStatus,
  ThinkingLevel,
  ModelInfo,
  TokenUsage,
  UsageCost,
  TurnUsage,
  ContextSegmentId,
  ContextSegment,
  ContextBreakdown,
  SessionUsageSnapshot,
  CompactSessionResult,
  UsageModelBucket,
  UsageDayBucket,
  UsageSummary,
  SessionInfo,
  BashCheckResult,
  BashLivenessKind,
  BashLivenessResult,
  GitCheckResult,
  AuthStatus,
  PiCliStatus,
  AgentSessionMode,
  GoalStatus,
  GoalInfo,
  SessionModeInfo,
  PlanFileLocation,
  PlanContentResult,
  PlanMutateResult,
  SessionModeResult,
  GoalResult,
  SecretCodecReason,
  SecretCodecStatus,
  OpenProjectResult,
  PromptResult,
  ImageContent,
  PromptPayload,
  HistoryItem,
  NoticeReplaceKey,
  FileRestoreSkipReason,
  FileRestoreReport,
  RetractOptions,
  RetractPreview,
  RetractResult,
  UiAgentEvent,
  HostStatus,
  GodotRpcStatusDto,
  GodotRpcCallDto,
  GodotRpcRequestResult,
  ToolDetailDto,
  ProjectDirEntryDto,
  ListProjectDirResult,
  ReadProjectFileResult,
  InstallGodotRpcAddonResult,
  PluginKind,
  PluginScope,
  PluginItem,
  PluginCreateInput,
  PluginReadResult,
  PluginWriteResult,
  PluginMutateResult,
  SessionSkillInfo,
  SessionSlashSource,
  SessionSlashItem,
  ProviderApiKind,
  ModelInput,
  ProviderModelEntry,
  ProviderProfile,
  ProviderProfileSummary,
  ProviderPreset,
  ProviderUpsertInput,
  ProviderActivateResult,
  FetchedProviderModel,
  FetchProviderModelsResult,
  ProviderImportResult,
  InstalledPackageInfo,
  PackageInstallResult,
  AppUpdateStatus,
  PrefsRecoveryNotice,
  StartupIssueStage,
  StartupIssue,
  ClientLogoId,
  LogoPreset,
  CustomLogo,
  LogoList,
  LogoUploadError,
  LogoUploadSuccess,
  LogoUploadResult,
  LogoClearResult,
  OpenProjectMode,
} from "./ipc/types";
export {
  THEME_IDS,
  type ThemeId,
  type ColorMode,
  THEME_LABELS,
  isThemeId,
  isColorMode,
  normalizeThemePrefs,
  type ClientPrefs,
  DEFAULT_PREFS,
  ClientPrefsSchema,
  ClientPrefsPatchSchema,
} from "./ipc/prefs";

// ----- value constants from types.ts (need runtime binding) -----
import { THINKING_LEVELS } from "./ipc/types";
export { THINKING_LEVELS };

import {
  DEFAULT_GOAL_MAX_TURNS,
  DEFAULT_GOAL_MAX_TOKENS,
  isRestorableGoalStatus,
} from "./ipc/types";
export {
  DEFAULT_GOAL_MAX_TURNS,
  DEFAULT_GOAL_MAX_TOKENS,
  isRestorableGoalStatus,
};
