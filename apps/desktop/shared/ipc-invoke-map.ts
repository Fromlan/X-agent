/**
 * IPC invoke channel signatures + 14 facade types (workspace/turn/plan/
 * session/prefs/appReport/logo/godot/updates/files/provider/plugin/
 * package/usage). Single source for preload ↔ main IPC contracts.
 *
 * History:
 *  - 2026-08-31 issue #60 主题 D C-301: 原 1475 行 god file 拆出
 *    IpcInvokeMap + DELETED_FLAT_KEYS + 9 facade 到此文件.
 *  - 2026-09-08 issue #65 主题 H: 加 IpcInvokeResult<K> 派生类型
 *    表达 "Result | SenderUntrustedError" 契约.
 *  - 2026-09-08 issue #2 flat-API 收尾:
 *    删 XAgentApiFlat / FlatInvokeApi / DELETED_FLAT_KEYS / DeletedFlatKey.
 *    渲染端必须走 facade 调用. 漏的 5 个分类(files / provider / plugin /
 *    package / usage)各加一个 facade, openPiLogin 归到 provider.login.
 *    XAgentApi 直接含 14 facade + onEvent + notifyAppReady (无 flat 表面).
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
 * `ok: false` 字段让 SenderUntrustedError 与业务 Result union 后仍然 narrowing
 * 兼容 (Result 都是 `{ ok: boolean; ... }`); renderer 端 `if (!result.ok)` 不会
 * 因为多了一个变体而 typecheck 失败, 然后用 `isSenderUntrustedError(result)`
 * 进一步 narrow. 这就是 IpcInvokeResult<K] 派生类型能直接表达 `Result |
 * SenderUntrustedError` 的关键.
 */
export interface SenderUntrustedError {
  readonly __senderUntrusted: true;
  readonly channel: string;
  readonly ok: false;
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
 * Project file-system + external URL operations (issue #2 flat-API 收尾).
 *
 * 涵盖原来 renderer 裸调的 4 个 channel: `listProjectDir`, `readProjectFile`,
 * `revealInFolder`, `openExternalUrl`. 后者虽然名字带"external", 但
 * 跟文件系统操作 (read / reveal) 都属于"宿主 shell / OS 资源"侧,
 * 放进 files facade 比新开 system facade 更紧凑.
 */
export type FilesApi = {
  list: IpcInvokeMap["listProjectDir"];
  read: IpcInvokeMap["readProjectFile"];
  reveal: IpcInvokeMap["revealInFolder"];
  openExternal: IpcInvokeMap["openExternalUrl"];
};

/**
 * Provider profile CRUD + Pi authentication facade (issue #2 flat-API 收尾).
 *
 * 9 个 channel 都跟"供应商 / 模型"有关, 原来在 XAgentApiFlat 裸调.
 * `login` 调起 Pi 登录流程 (Pi CLI), 跟 model 选型紧密相关, 一起放这里.
 */
export type ProviderApi = {
  listProfiles: IpcInvokeMap["listProviderProfiles"];
  getProfile: IpcInvokeMap["getProviderProfile"];
  upsertProfile: IpcInvokeMap["upsertProviderProfile"];
  deleteProfile: IpcInvokeMap["deleteProviderProfile"];
  setProfileEnabled: IpcInvokeMap["setProviderProfileEnabled"];
  listPresets: IpcInvokeMap["listProviderPresets"];
  importExisting: IpcInvokeMap["importExistingProviderProfiles"];
  fetchModels: IpcInvokeMap["fetchProviderModels"];
  login: IpcInvokeMap["openPiLogin"];
};

/**
 * Plugin CRUD facade (issue #2 flat-API 收尾).
 *
 * 涵盖 prompt / skill / extension / theme 四种 plugin 的 list / read / write
 * / create / delete / reveal 操作. 设置 → 插件页面唯一入口.
 */
export type PluginApi = {
  list: IpcInvokeMap["listPlugins"];
  read: IpcInvokeMap["readPlugin"];
  write: IpcInvokeMap["writePlugin"];
  create: IpcInvokeMap["createPlugin"];
  delete: IpcInvokeMap["deletePlugin"];
  reveal: IpcInvokeMap["revealPlugin"];
};

/**
 * Pi Package install / uninstall facade (issue #2 flat-API 收尾).
 *
 * 涵盖 `pi install` / `pi uninstall` 周边 4 个 channel. Godot Pi 单独一个
 * 方法以便 UI 给"安装 godot-pi 配套包"打独立按钮.
 */
export type PackageApi = {
  list: IpcInvokeMap["listInstalledPackages"];
  install: IpcInvokeMap["installPackage"];
  uninstall: IpcInvokeMap["uninstallPackage"];
  installGodotPi: IpcInvokeMap["installGodotPiPackage"];
};

/**
 * Usage / cost summary facade (issue #2 flat-API 收尾).
 *
 * 2 个 channel, 设置 → 用量页面的数据源.
 */
export type UsageApi = {
  getSummary: IpcInvokeMap["getUsageSummary"];
  clearSummary: IpcInvokeMap["clearUsageSummary"];
};

/**
 * Authoritative invoke-channel signatures: every key is one `ipcRenderer.invoke`
 * channel (key name == channel name, enforced at compile time against
 * IPC_CHANNELS). Preload forwarding and main-process handlers are both typed
 * against this map, so a channel signature lives in exactly one place.
 *
 * **Sender-trust 契约 (issue #65 主题 H, 2026-08-31)**: 每个 channel 的 resolve
 * 类型是它原本的 Result (例如 `PromptResult`); 但 register-ipc.ts 在 main 端
 * 校验 sender 不可信时会 throw `SenderUntrustedError`, IPC 协议让该 throw 透
 * 传到 renderer 端 `await` 的 reject 路径, 渲染端 catch 块拿到
 * `SenderUntrustedError` 对象. 这个契约在 resolve 类型层面不可表达 (TS 的
 * Promise resolve 路径不携带 throw 类型), 所以用派生类型 `IpcInvokeResult<K>`
 * 把契约显式建模: `Result | SenderUntrustedError`. 详见 SenderUntrustedError
 * doc (为什么 `ok: false` 字段让 union narrowing 仍然 work).
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
 * 协议层 IPC 通道产出契约 (issue #65 主题 H, 2026-08-31).
 *
 * 表达 "成功 resolve 为 IpcInvokeMap[K] 的返回类型, 失败 throw 被 catch 时
 * 拿到 SenderUntrustedError" 的 union 类型. 调用方写穷举 catch 时可以用:
 *
 * ```ts
 * try {
 *   const result = await window.xAgent.turn.prompt(payload);
 *   // result: Awaited<ReturnType<typeof window.xAgent.turn.prompt>>
 * } catch (e) {
 *   if (isSenderUntrustedError(e)) {
 *     // 渲染端拒绝, sender 不可信
 *   } else {
 *     // 业务错误
 *   }
 * }
 * ```
 *
 * 用 `Awaited<ReturnType<...>>` 而不是直接 `ReturnType<...>` 因为 IPC 通道
 * 都是 async (返回 `Promise<...>`), 需要把 Promise 包装拆开.
 *
 * 这个派生类型不改 IpcInvokeMap[K] 的 resolve 类型 (避免 100+ consumer narrowing
 * 失败), 仅作为 "类型层契约" 暴露. 真实 channel 的 catch 块 contract 始终
 * 是 `unknown`, typeguard 永远要走 `isSenderUntrustedError`.
 */
export type IpcInvokeResult<K extends keyof IpcInvokeMap> =
  | Awaited<ReturnType<IpcInvokeMap[K]>>
  | SenderUntrustedError;

/** Compile-time gate: IpcInvokeMap keys must exactly cover IPC_CHANNELS keys. */
declare const _assertInvokeMapCoverage: Exclude<
  IpcChannelKey,
  keyof IpcInvokeMap
> extends never
  ? Exclude<keyof IpcInvokeMap, IpcChannelKey> extends never
    ? true
    : never
  : never;

/**
 * `window.xAgent` 全表面 (issue #2 flat-API 收尾, 2026-09-08).
 *
 * 之前 XAgentApi 通过 `extends XAgentApiFlat` 继承所有 IPC 通道, 让
 * renderer 可以 `window.xAgent.prompt(...)` 裸调. 现在 flat surface 已删
 * (renderer 必须走 facade, 例如 `window.xAgent.turn.prompt(...)`), 这个
 * interface 只列:
 *
 *  - 14 个 facade (workspace/turn/plan/session/prefs/appReport/logo/godot/
 *    updates/files/provider/plugin/package/usage)
 *  - 2 个 top-level 事件 / 启动: `onEvent` (agent push) + `notifyAppReady`
 *    (renderer boot 完成信号, splash 关闭)
 */
export type UpdatesApi = {
  getStatus: IpcInvokeMap["getUpdateStatus"];
  check: IpcInvokeMap["checkForUpdates"];
  download: IpcInvokeMap["downloadUpdate"];
  install: IpcInvokeMap["installUpdate"];
  onStatus: (handler: (status: AppUpdateStatus) => void) => () => void;
};

export interface XAgentApi {
  workspace: WorkspaceApi;
  turn: TurnApi;
  plan: PlanApi;
  session: SessionApi;
  prefs: PrefsApi;
  appReport: AppReportApi;
  godot: GodotApi;
  updates: UpdatesApi;
  logo: LogoApi;
  files: FilesApi;
  provider: ProviderApi;
  plugin: PluginApi;
  package: PackageApi;
  usage: UsageApi;
  /** Subscribe to main-process `agentEvent` pushes. */
  onEvent: (handler: (event: UiAgentEvent) => void) => () => void;
  /**
   * Signal main process that renderer boot finished — closes splash and
   * shows the main window. 不属于任何 facade (一次性的 boot 信号).
   */
  notifyAppReady: () => Promise<{ ok: boolean }>;
}
