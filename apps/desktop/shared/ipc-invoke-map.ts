/**
 * IPC invoke channel signatures + 9 facade types (workspace/turn/plan/
 * session/prefs/appReport/logo/godot/updates). Single source for
 * preload ↔ main IPC contracts.
 *
 * Split from shared/ipc.ts (issue #60 主题 D C-301, 2026-08-31):
 * 原 1475 行 god file 拆出 IpcInvokeMap + DELETED_FLAT_KEYS + 9 facade
 * (~225 行) 到此文件; 共享类型 (OpenProjectResult, PromptResult 等)
 * 仍从 shared/ipc.ts re-export 走 barrel, 避免双源.
 */
import type { IpcChannelKey } from "./ipc-channels";
import type { SessionType } from "./session-type";
import type {
  AgentSessionMode,
  AppUpdateStatus,
  ClientPrefs,
  CompactSessionResult,
  GoalInfo,
  GoalResult,
  InstallGodotRpcAddonResult,
  LogoClearResult,
  LogoList,
  LogoUploadResult,
  ModelInfo,
  OpenProjectMode,
  OpenProjectResult,
  PackageInstallResult,
  PlanContentResult,
  PlanMutateResult,
  PluginCreateInput,
  PluginItem,
  PluginMutateResult,
  PluginReadResult,
  PluginWriteResult,
  PrefsRecoveryNotice,
  PromptPayload,
  PromptResult,
  ProviderImportResult,
  ProviderPreset,
  ProviderProfile,
  ProviderProfileSummary,
  ProviderUpsertInput,
  RetractOptions,
  RetractPreview,
  RetractResult,
  SecretCodecStatus,
  SessionInfo,
  SessionModeInfo,
  SessionModeResult,
  SessionSlashItem,
  SessionUsageSnapshot,
  StartupIssue,
  ThinkingLevel,
  UiAgentEvent,
  UsageSummary,
  AuthStatus,
  BashCheckResult,
  BashLivenessResult,
  GitCheckResult,
  GodotRpcCallDto,
  GodotRpcRequestResult,
  GodotRpcStatusDto,
  HostStatus,
  InstalledPackageInfo,
  ListProjectDirResult,
  PiCliStatus,
  ReadProjectFileResult,
  ToolDetailDto,
  FetchProviderModelsResult,
} from "./ipc";

/** Coarse workspace / session lifecycle facade (facade methods stay on window.xAgent). */
export type WorkspaceApi = {
  open: IpcInvokeMap["openProject"];
  close: IpcInvokeMap["closeWorkspace"];
  newSession: IpcInvokeMap["newSession"];
  resume: IpcInvokeMap["resumeSession"];
  listSessions: IpcInvokeMap["listSessions"];
  deleteSession: IpcInvokeMap["deleteSession"];
  deleteProjectSessions: IpcInvokeMap["deleteProjectSessions"];
  renameSession: IpcInvokeMap["renameSession"];
  getStatus: IpcInvokeMap["getStatus"];
};

/**
 * 不可信 sender 异常契约 (issue #65 主题 H, 2026-08-31).
 *
 * 之前 register-ipc.ts 在 sender trust 校验失败时 throw `new Error("IPC 调用来源不受信任")`,
 * renderer 端 catch 块拿到的是普通 Error, 无法与业务错误区分.
 *
 * 现在抛契约化异常, renderer 可用 `isSenderUntrustedError(e)` typeguard 判断.
 * 字段 `__senderUntrusted: true` 是 tag (类似 fp-ts 的 Discriminated Union),
 * 不会被业务 Result 误判. `channel` 字段方便日志追踪是哪个 IPC 通道拒绝.
 *
 * 不在 IpcInvokeMap[K] 联合类型中加这个变体: 那样会让 100+ 个 renderer consumer
 * 全部 typecheck 失败 (Result 多了一个无 `.ok` 字段的变体). 当前只把契约暴露给
 * sender guard 测试 + 给未来 IpcInvokeMap 二次改造留 hook. 详见 register-ipc.ts.
 */
export interface SenderUntrustedError {
  readonly __senderUntrusted: true;
  readonly channel: string;
}

/** Typeguard: e 是 register-ipc.ts 抛的不可信 sender 异常. */
export function isSenderUntrustedError(
  e: unknown,
): e is SenderUntrustedError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { __senderUntrusted?: unknown }).__senderUntrusted === true &&
    typeof (e as { channel?: unknown }).channel === "string"
  );
}

/** Coarse turn / composer facade (facade methods stay on window.xAgent). */
export type TurnApi = {
  prompt: IpcInvokeMap["prompt"];
  abort: IpcInvokeMap["abort"];
  previewRetract: IpcInvokeMap["previewRetract"];
  retract: IpcInvokeMap["retractToUserMessage"];
  editAndResend: IpcInvokeMap["editAndResend"];
  regenerate: IpcInvokeMap["regenerateFromUser"];
};

/** Coarse plan / goal mode facade (facade methods stay on window.xAgent). */
export type PlanApi = {
  setMode: IpcInvokeMap["setSessionMode"];
  getMode: IpcInvokeMap["getSessionMode"];
  build: IpcInvokeMap["buildPlan"];
  getContent: IpcInvokeMap["getPlanContent"];
  saveContent: IpcInvokeMap["savePlanContent"];
  saveToWorkspace: IpcInvokeMap["savePlanToWorkspace"];
  clear: IpcInvokeMap["clearPlan"];
  setGoal: IpcInvokeMap["setGoal"];
  pauseGoal: IpcInvokeMap["pauseGoal"];
  resumeGoal: IpcInvokeMap["resumeGoal"];
  clearGoal: IpcInvokeMap["clearGoal"];
  getGoal: IpcInvokeMap["getGoal"];
};

/** Coarse session meta facade (model, thinking, list, delete, rename, etc). */
export type SessionApi = {
  listModels: IpcInvokeMap["listModels"];
  setModel: IpcInvokeMap["setModel"];
  setThinkingLevel: IpcInvokeMap["setThinkingLevel"];
  getSessionUsage: IpcInvokeMap["getSessionUsage"];
  compactSession: IpcInvokeMap["compactSession"];
  getToolDetail: IpcInvokeMap["getToolDetail"];
  reloadResources: IpcInvokeMap["reloadResources"];
  listSessionSlashItems: IpcInvokeMap["listSessionSlashItems"];
};

/** Client prefs + runtime dependency checks. */
export type PrefsApi = {
  get: IpcInvokeMap["getPrefs"];
  set: IpcInvokeMap["setPrefs"];
  getRecoveryNotice: IpcInvokeMap["getPrefsRecoveryNotice"];
  getSecretCodecStatus: IpcInvokeMap["getSecretCodecStatus"];
  checkBash: IpcInvokeMap["checkBash"];
  checkBashLiveness: IpcInvokeMap["checkBashLiveness"];
  applyBashShellPath: IpcInvokeMap["applyBashShellPath"];
  pickBashShell: IpcInvokeMap["pickBashShell"];
  checkGit: IpcInvokeMap["checkGit"];
  checkAuth: IpcInvokeMap["checkAuth"];
  checkPiCli: IpcInvokeMap["checkPiCli"];
  installPiCli: IpcInvokeMap["installPiCli"];
};

/** Coarse startup-failure report (recover / bridge / package install). */
export type AppReportApi = {
  getStartupReport: IpcInvokeMap["getStartupReport"];
};

/**
 * Client logo asset management. The actual `clientLogoId` selection lives in
 * `ClientPrefs` (set via `prefs.set`); this facade only handles the binary
 * asset side (preset enumeration, custom upload/clear).
 */
export type LogoApi = {
  listPresets: IpcInvokeMap["logoListPresets"];
  uploadCustom: IpcInvokeMap["logoUploadCustom"];
  clearCustom: IpcInvokeMap["logoClearCustom"];
  /** Subscribe to main-process `logo:changed` pushes (e.g. when another window / a tool flips the active id). */
  onChanged: (handler: (payload: { id: string }) => void) => () => void;
};

/** Godot editor RPC + addon lifecycle facade. */
export type GodotApi = {
  status: IpcInvokeMap["godotRpcStatus"];
  start: IpcInvokeMap["godotRpcStart"];
  stop: IpcInvokeMap["godotRpcStop"];
  ping: IpcInvokeMap["godotRpcPing"];
  request: IpcInvokeMap["godotRpcRequest"];
  setActiveClient: IpcInvokeMap["godotRpcSetActiveClient"];
  installAddon: IpcInvokeMap["installGodotRpcAddon"];
  launchEditor: IpcInvokeMap["launchGodotEditor"];
  pickEditor: IpcInvokeMap["pickGodotEditor"];
  pickScene: IpcInvokeMap["pickGodotScene"];
};

/**
 * Authoritative invoke-channel signatures: every key is one `ipcRenderer.invoke`
 * channel (key name == channel name, enforced at compile time against
 * IPC_CHANNELS). Preload forwarding and main-process handlers are both typed
 * against this map, so a channel signature lives in exactly one place.
 */
export type IpcInvokeMap = {
  openProject: (path?: string, mode?: OpenProjectMode) => Promise<OpenProjectResult>;
  prompt: (payload: PromptPayload) => Promise<PromptResult>;
  abort: () => Promise<{ ok: boolean }>;
  previewRetract: (entryId: string) => Promise<RetractPreview>;
  retractToUserMessage: (entryId: string, options?: RetractOptions) => Promise<RetractResult>;
  editAndResend: (entryId: string, text: string, options?: RetractOptions) => Promise<RetractResult>;
  regenerateFromUser: (entryId: string, options?: RetractOptions) => Promise<RetractResult>;
  newSession: (sessionType?: SessionType) => Promise<OpenProjectResult>;
  setModel: (provider: string, id: string) => Promise<{ ok: boolean; error?: string }>;
  setThinkingLevel: (
    level: ThinkingLevel,
  ) => Promise<{ ok: boolean; thinkingLevel?: ThinkingLevel }>;
  setSessionMode: (mode: AgentSessionMode) => Promise<SessionModeResult>;
  getSessionMode: () => Promise<SessionModeInfo>;
  buildPlan: () => Promise<PromptResult>;
  getPlanContent: () => Promise<PlanContentResult>;
  savePlanContent: (markdown: string) => Promise<PlanMutateResult>;
  savePlanToWorkspace: () => Promise<PlanMutateResult>;
  clearPlan: () => Promise<PlanMutateResult>;
  setGoal: (condition: string) => Promise<GoalResult>;
  pauseGoal: () => Promise<GoalResult>;
  resumeGoal: () => Promise<GoalResult>;
  clearGoal: () => Promise<GoalResult>;
  getGoal: () => Promise<GoalInfo | null>;
  listModels: () => Promise<ModelInfo[]>;
  listSessions: () => Promise<SessionInfo[]>;
  resumeSession: (sessionPath: string) => Promise<OpenProjectResult>;
  deleteSession: (sessionPath: string) => Promise<{ ok: boolean; error?: string }>;
  /** Delete all X-agent sessions for a project cwd. */
  deleteProjectSessions: (
    projectCwd: string,
  ) => Promise<{ ok: boolean; deleted?: number; error?: string }>;
  /** Close current workspace without deleting session files. */
  closeWorkspace: () => Promise<{ ok: boolean; error?: string }>;
  renameSession: (
    sessionPath: string,
    name: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  getStatus: () => Promise<HostStatus>;
  getToolDetail: (toolCallId: string) => Promise<ToolDetailDto | null>;
  getSessionUsage: () => Promise<SessionUsageSnapshot | null>;
  compactSession: (customInstructions?: string) => Promise<CompactSessionResult>;
  reloadResources: () => Promise<{ ok: boolean; reloaded: boolean; error?: string }>;
  getPrefs: () => Promise<ClientPrefs>;
  setPrefs: (patch: Partial<ClientPrefs>) => Promise<ClientPrefs>;
  /** Returns and clears the startup prefs-recovery notice, if any. */
  getPrefsRecoveryNotice: () => Promise<PrefsRecoveryNotice | null>;
  /** Returns and clears the startup-issue queue (recover / bridge / package install). */
  getStartupReport: () => Promise<StartupIssue[]>;
  getSecretCodecStatus: () => Promise<SecretCodecStatus>;
  checkBash: () => Promise<BashCheckResult>;
  checkBashLiveness: () => Promise<BashLivenessResult>;
  applyBashShellPath: (shellPath?: string) => Promise<BashCheckResult>;
  pickBashShell: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  checkGit: () => Promise<GitCheckResult>;
  checkAuth: () => Promise<AuthStatus>;
  checkPiCli: () => Promise<PiCliStatus>;
  installPiCli: () => Promise<PiCliStatus>;
  listProjectDir: (relPath?: string) => Promise<ListProjectDirResult>;
  readProjectFile: (relPath: string) => Promise<ReadProjectFileResult>;
  revealInFolder: (relPath: string) => Promise<{ ok: boolean; error?: string }>;
  godotRpcStatus: () => Promise<GodotRpcStatusDto>;
  godotRpcStart: () => Promise<GodotRpcStatusDto>;
  godotRpcStop: () => Promise<{ ok: boolean }>;
  godotRpcPing: () => Promise<GodotRpcRequestResult>;
  godotRpcRequest: (
    call: GodotRpcCallDto,
    options?: { clientId?: string | null },
  ) => Promise<GodotRpcRequestResult>;
  godotRpcSetActiveClient: (
    clientId: string | null,
  ) => Promise<{ ok: boolean; status: GodotRpcStatusDto }>;
  pickGodotEditor: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  launchGodotEditor: () => Promise<{
    ok: boolean;
    error?: string;
    port?: number;
    hint?: string;
  }>;
  installGodotRpcAddon: () => Promise<InstallGodotRpcAddonResult>;
  pickGodotScene: () => Promise<{
    ok: boolean;
    path?: string;
    canceled?: boolean;
    error?: string;
  }>;
  listPlugins: (cwd?: string | null) => Promise<PluginItem[]>;
  /** Skills + prompt templates + extension commands for composer `/` autocomplete. */
  listSessionSlashItems: () => Promise<SessionSlashItem[]>;
  readPlugin: (path: string) => Promise<PluginReadResult>;
  writePlugin: (path: string, content: string) => Promise<PluginWriteResult>;
  createPlugin: (input: PluginCreateInput) => Promise<PluginMutateResult>;
  deletePlugin: (path: string) => Promise<{ ok: boolean; error?: string }>;
  revealPlugin: (path: string) => Promise<{ ok: boolean; error?: string }>;
  listProviderProfiles: () => Promise<ProviderProfileSummary[]>;
  getProviderProfile: (id: string) => Promise<ProviderProfile | null>;
  upsertProviderProfile: (
    input: ProviderUpsertInput,
  ) => Promise<{
    ok: boolean;
    profile?: ProviderProfile;
    error?: string;
    /** Profile was written into Pi auth/models (enabled profiles only). */
    syncedToPi?: boolean;
  }>;
  deleteProviderProfile: (id: string) => Promise<{ ok: boolean; error?: string }>;
  setProviderProfileEnabled: (
    id: string,
    enabled: boolean,
  ) => Promise<{ ok: boolean; error?: string; syncedToPi?: boolean }>;
  listProviderPresets: () => Promise<ProviderPreset[]>;
  importExistingProviderProfiles: () => Promise<ProviderImportResult>;
  fetchProviderModels: (input: {
    baseUrl: string;
    apiKey: string;
  }) => Promise<FetchProviderModelsResult>;
  listInstalledPackages: () => Promise<InstalledPackageInfo[]>;
  installPackage: (source: string) => Promise<PackageInstallResult>;
  uninstallPackage: (
    source: string,
  ) => Promise<{ ok: boolean; error?: string; output?: string }>;
  installGodotPiPackage: () => Promise<PackageInstallResult>;
  openPiLogin: () => Promise<{ ok: boolean; error?: string; hint?: string }>;
  /** Open an http(s) URL in the system browser. */
  openExternalUrl: (url: string) => Promise<{ ok: boolean; error?: string }>;
  getUpdateStatus: () => Promise<AppUpdateStatus>;
  checkForUpdates: () => Promise<AppUpdateStatus>;
  downloadUpdate: () => Promise<AppUpdateStatus>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  getUsageSummary: (options?: {
    days?: number;
  }) => Promise<UsageSummary>;
  clearUsageSummary: () => Promise<{ ok: boolean; error?: string }>;
  /** Signal main process that renderer boot finished — closes splash and shows the main window. */
  appReady: () => Promise<{ ok: boolean }>;
  /** Built-in logo presets + user-uploaded customs + currently active id. */
  logoListPresets: () => Promise<LogoList>;
  /**
   * Show a native file picker, validate the chosen file, save it under
   * `~/.pi/agent/x-agent-logos/`, and return its descriptor. The renderer is
   * expected to call `setPrefs({ clientLogoId: result.logo.id })` afterwards
   * if the user wants this to become active.
   *
   * `result.ok === false` when the user cancels (code `INVALID_FILE` with
   * `error: "已取消"`), the file fails validation, or write fails.
   */
  logoUploadCustom: () => Promise<LogoUploadResult>;
  /** Delete a custom logo. If it was the active one, also reverts to `default`. */
  logoClearCustom: (customId: string) => Promise<LogoClearResult>;
};

/**
 * Flat channel methods removed from `window.xAgent` — their functionality lives
 * on the workspace / turn / plan / session / prefs facades. Removing an entry
 * here is safe only if the renderer has no direct callers left (facades are
 * typed against IpcInvokeMap, not XAgentApiFlat).
 */
export const DELETED_FLAT_KEYS = [
  "openProject",
  "prompt",
  "abort",
  "getStatus",
  "newSession",
  "setModel",
  "setSessionMode",
  "getSessionMode",
  "buildPlan",
  "getPlanContent",
  "savePlanContent",
  "savePlanToWorkspace",
  "clearPlan",
  "setGoal",
  "pauseGoal",
  "resumeGoal",
  "clearGoal",
  "getGoal",
  "listModels",
  "listSessions",
  "resumeSession",
  "deleteSession",
  "deleteProjectSessions",
  "closeWorkspace",
  "renameSession",
  "previewRetract",
  "retractToUserMessage",
  "editAndResend",
  "regenerateFromUser",
  "getSessionUsage",
  "getPrefsRecoveryNotice",
  "getSecretCodecStatus",
  "compactSession",
  "getToolDetail",
  "reloadResources",
  "listSessionSlashItems",
] as const;

export type DeletedFlatKey = (typeof DELETED_FLAT_KEYS)[number];

/** Every invoke channel keyed by channel name — the generated preload surface. */
export type FlatInvokeApi = { [K in IpcChannelKey]: IpcInvokeMap[K] };

/** Flat IPC surface exposed directly on `window.xAgent` (legacy; prefer facades). */
export type XAgentApiFlat = Omit<FlatInvokeApi, DeletedFlatKey> & {
  notifyAppReady: () => Promise<{ ok: boolean }>;
  onEvent: (handler: (event: UiAgentEvent) => void) => () => void;
  onUpdateStatus: (handler: (status: AppUpdateStatus) => void) => () => void;
};

/** Compile-time gate: IpcInvokeMap keys must exactly cover IPC_CHANNELS keys. */
declare const _assertInvokeMapCoverage: Exclude<
  IpcChannelKey,
  keyof IpcInvokeMap
> extends never
  ? Exclude<keyof IpcInvokeMap, IpcChannelKey> extends never
    ? true
    : never
  : never;

/** Compile-time gate: DELETED_FLAT_KEYS entries must be real channel keys. */
declare const _assertDeletedKeysValid: Exclude<
  DeletedFlatKey,
  IpcChannelKey
> extends never
  ? true
  : never;

export interface XAgentApi extends XAgentApiFlat {
  workspace: WorkspaceApi;
  turn: TurnApi;
  plan: PlanApi;
  session: SessionApi;
  prefs: PrefsApi;
  appReport: AppReportApi;
  godot: GodotApi;
  updates: UpdatesApi;
  logo: LogoApi;
}

/** Update UX facade. */
export type UpdatesApi = {
  getStatus: IpcInvokeMap["getUpdateStatus"];
  check: IpcInvokeMap["checkForUpdates"];
  download: IpcInvokeMap["downloadUpdate"];
  install: IpcInvokeMap["installUpdate"];
  onStatus: XAgentApiFlat["onUpdateStatus"];
};
