/**
 * Central registry of every `ipcMain.handle` / `ipcRenderer.invoke` channel
 * name used across the main process, preload bridge, and IPC registrars.
 * Keep this in sync when adding/removing/renaming an IPC channel.
 */
export const IPC_CHANNELS = {
  // session / workspace (see electron/ipc/register-workspace-ipc.ts + app-runtime.ts)
  openProject: "openProject",
  prompt: "prompt",
  abort: "abort",
  previewRetract: "previewRetract",
  retractToUserMessage: "retractToUserMessage",
  editAndResend: "editAndResend",
  regenerateFromUser: "regenerateFromUser",
  newSession: "newSession",
  setModel: "setModel",
  setThinkingLevel: "setThinkingLevel",
  setSessionMode: "setSessionMode",
  getSessionMode: "getSessionMode",
  buildPlan: "buildPlan",
  getPlanContent: "getPlanContent",
  savePlanContent: "savePlanContent",
  savePlanToWorkspace: "savePlanToWorkspace",
  clearPlan: "clearPlan",
  setGoal: "setGoal",
  pauseGoal: "pauseGoal",
  resumeGoal: "resumeGoal",
  clearGoal: "clearGoal",
  getGoal: "getGoal",

  // project-level stage workflow (see electron/ipc/register-stage-ipc.ts)
  getStage: "getStage",
  setStage: "setStage",
  getGraduation: "getGraduation",
  toggleManualCheck: "toggleManualCheck",
  listModels: "listModels",
  listSessions: "listSessions",
  resumeSession: "resumeSession",
  deleteSession: "deleteSession",
  deleteProjectSessions: "deleteProjectSessions",
  closeWorkspace: "closeWorkspace",
  renameSession: "renameSession",
  getStatus: "getStatus",
  getToolDetail: "getToolDetail",
  getSessionUsage: "getSessionUsage",
  compactSession: "compactSession",
  reloadResources: "reloadResources",

  // prefs / environment checks (see electron/app-runtime.ts)
  getPrefs: "getPrefs",
  setPrefs: "setPrefs",
  checkBash: "checkBash",
  checkBashLiveness: "checkBashLiveness",
  applyBashShellPath: "applyBashShellPath",
  pickBashShell: "pickBashShell",
  checkGit: "checkGit",
  checkAuth: "checkAuth",
  checkPiCli: "checkPiCli",
  installPiCli: "installPiCli",

  // project filesystem sandbox (see electron/app-runtime.ts)
  listProjectDir: "listProjectDir",
  readProjectFile: "readProjectFile",
  revealInFolder: "revealInFolder",

  // Godot RPC bridge + editor launch (see electron/ipc/register-godot-ipc.ts)
  godotRpcStatus: "godotRpcStatus",
  godotRpcStart: "godotRpcStart",
  godotRpcStop: "godotRpcStop",
  godotRpcPing: "godotRpcPing",
  godotRpcRequest: "godotRpcRequest",
  godotRpcSetActiveClient: "godotRpcSetActiveClient",
  pickGodotEditor: "pickGodotEditor",
  launchGodotEditor: "launchGodotEditor",
  installGodotRpcAddon: "installGodotRpcAddon",
  pickGodotScene: "pickGodotScene",

  // plugins (prompt / skill / extension / theme) (see electron/app-runtime.ts)
  listPlugins: "listPlugins",
  listSessionSlashItems: "listSessionSlashItems",
  readPlugin: "readPlugin",
  writePlugin: "writePlugin",
  createPlugin: "createPlugin",
  deletePlugin: "deletePlugin",
  revealPlugin: "revealPlugin",

  // provider profiles / model catalog (see electron/ipc/register-provider-ipc.ts)
  listProviderProfiles: "listProviderProfiles",
  getProviderProfile: "getProviderProfile",
  upsertProviderProfile: "upsertProviderProfile",
  deleteProviderProfile: "deleteProviderProfile",
  setProviderProfileEnabled: "setProviderProfileEnabled",
  listProviderPresets: "listProviderPresets",
  importExistingProviderProfiles: "importExistingProviderProfiles",
  fetchProviderModels: "fetchProviderModels",

  // Pi packages (see electron/app-runtime.ts)
  listInstalledPackages: "listInstalledPackages",
  installPackage: "installPackage",
  uninstallPackage: "uninstallPackage",
  installGodotPiPackage: "installGodotPiPackage",

  // misc / app-level (see electron/app-runtime.ts)
  openPiLogin: "openPiLogin",
  openExternalUrl: "openExternalUrl",
  getUpdateStatus: "getUpdateStatus",
  checkForUpdates: "checkForUpdates",
  downloadUpdate: "downloadUpdate",
  installUpdate: "installUpdate",
  getUsageSummary: "getUsageSummary",
  clearUsageSummary: "clearUsageSummary",
  /** One-shot prefs recovery notice after corrupt x-agent.json backup. */
  getPrefsRecoveryNotice: "getPrefsRecoveryNotice",
  /** SafeStorage fallback status (keychain unavailable / encrypt failed) for UI banner. */
  getSecretCodecStatus: "getSecretCodecStatus",
  /** 启动期失败摘要（recover / bridge / package install），renderer 在 ReadyChecklist 读取。 */
  getStartupReport: "getStartupReport",
  /** Renderer signals first paint so splash can reveal the main window. */
  appReady: "appReady",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Key names of IPC_CHANNELS — used as the single source of truth for channel identity. */
export type IpcChannelKey = keyof typeof IPC_CHANNELS;

/** Main → renderer push event channel names (`webContents.send` / `ipcRenderer.on`). */
export const IPC_EVENTS = {
  agentEvent: "agent:event",
  updateStatus: "update:status",
  stageChanged: "stage:changed",
} as const;

export type IpcEventChannel = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];
