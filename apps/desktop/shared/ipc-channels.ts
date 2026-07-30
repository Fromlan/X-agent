/**
 * Central registry of every `ipcMain.handle` / `ipcRenderer.invoke` channel
 * name used across the main process, preload bridge, and IPC registrars.
 * Keep this in sync when adding/removing/renaming an IPC channel.
 */
export const IPC_CHANNELS = {
  // session / workspace (see electron/ipc/register-session-ipc.ts)
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

  // prefs / environment checks (see electron/main.ts)
  getPrefs: "getPrefs",
  setPrefs: "setPrefs",
  checkBash: "checkBash",
  applyBashShellPath: "applyBashShellPath",
  pickBashShell: "pickBashShell",
  checkAuth: "checkAuth",
  checkPiCli: "checkPiCli",
  installPiCli: "installPiCli",

  // project filesystem sandbox (see electron/main.ts)
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

  // Godot official docs cache (see electron/ipc/register-godot-ipc.ts)
  godotDocsGetStatus: "godotDocsGetStatus",
  godotDocsListRemoteBranches: "godotDocsListRemoteBranches",
  godotDocsSetBranch: "godotDocsSetBranch",
  godotDocsOpenDownloadUrl: "godotDocsOpenDownloadUrl",
  godotDocsImportZip: "godotDocsImportZip",
  godotDocsRemoveLocal: "godotDocsRemoveLocal",

  // plugins (prompt / skill / extension / theme) (see electron/main.ts)
  listPlugins: "listPlugins",
  listSessionSkills: "listSessionSkills",
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
  activateProviderProfile: "activateProviderProfile",
  listProviderPresets: "listProviderPresets",
  importExistingProviderProfiles: "importExistingProviderProfiles",
  fetchProviderModels: "fetchProviderModels",

  // Pi packages (see electron/main.ts)
  listInstalledPackages: "listInstalledPackages",
  installPackage: "installPackage",
  uninstallPackage: "uninstallPackage",
  installGodotPiPackage: "installGodotPiPackage",

  // misc / app-level (see electron/main.ts)
  openPiLogin: "openPiLogin",
  openExternalUrl: "openExternalUrl",
  getUpdateStatus: "getUpdateStatus",
  checkForUpdates: "checkForUpdates",
  downloadUpdate: "downloadUpdate",
  installUpdate: "installUpdate",
  getUsageSummary: "getUsageSummary",
  clearUsageSummary: "clearUsageSummary",
  /** Renderer signals first paint so splash can reveal the main window. */
  appReady: "appReady",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Main → renderer push event channel names (`webContents.send` / `ipcRenderer.on`). */
export const IPC_EVENTS = {
  agentEvent: "agent:event",
  updateStatus: "update:status",
} as const;

export type IpcEventChannel = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];
