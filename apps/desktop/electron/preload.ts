import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentSessionMode,
  AppUpdateStatus,
  XAgentApi,
  ClientPrefs,
  PluginCreateInput,
  ProviderUpsertInput,
  ThinkingLevel,
  UiAgentEvent,
} from "../shared/ipc";
import { IPC_CHANNELS, IPC_EVENTS } from "../shared/ipc-channels";

const api: XAgentApi = {
  // session / workspace
  openProject: (path?: string) => ipcRenderer.invoke(IPC_CHANNELS.openProject, path),
  prompt: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.prompt, text),
  abort: () => ipcRenderer.invoke(IPC_CHANNELS.abort),
  previewRetract: (entryId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewRetract, entryId),
  retractToUserMessage: (
    entryId: string,
    options?: { undoFiles?: boolean },
  ) => ipcRenderer.invoke(IPC_CHANNELS.retractToUserMessage, entryId, options),
  editAndResend: (
    entryId: string,
    text: string,
    options?: { undoFiles?: boolean },
  ) => ipcRenderer.invoke(IPC_CHANNELS.editAndResend, entryId, text, options),
  regenerateFromUser: (
    entryId: string,
    options?: { undoFiles?: boolean },
  ) => ipcRenderer.invoke(IPC_CHANNELS.regenerateFromUser, entryId, options),
  newSession: () => ipcRenderer.invoke(IPC_CHANNELS.newSession),
  setModel: (provider: string, id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.setModel, provider, id),
  setThinkingLevel: (level: ThinkingLevel) =>
    ipcRenderer.invoke(IPC_CHANNELS.setThinkingLevel, level),
  setSessionMode: (mode: AgentSessionMode) =>
    ipcRenderer.invoke(IPC_CHANNELS.setSessionMode, mode),
  getSessionMode: () => ipcRenderer.invoke(IPC_CHANNELS.getSessionMode),
  buildPlan: () => ipcRenderer.invoke(IPC_CHANNELS.buildPlan),
  getPlanContent: () => ipcRenderer.invoke(IPC_CHANNELS.getPlanContent),
  savePlanContent: (markdown: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.savePlanContent, markdown),
  savePlanToWorkspace: () =>
    ipcRenderer.invoke(IPC_CHANNELS.savePlanToWorkspace),
  clearPlan: () => ipcRenderer.invoke(IPC_CHANNELS.clearPlan),
  setGoal: (condition: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.setGoal, condition),
  clearGoal: () => ipcRenderer.invoke(IPC_CHANNELS.clearGoal),
  getGoal: () => ipcRenderer.invoke(IPC_CHANNELS.getGoal),
  listModels: () => ipcRenderer.invoke(IPC_CHANNELS.listModels),
  listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.listSessions),
  resumeSession: (sessionPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.resumeSession, sessionPath),
  deleteSession: (sessionPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteSession, sessionPath),
  deleteProjectSessions: (projectCwd: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteProjectSessions, projectCwd),
  closeWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.closeWorkspace),
  renameSession: (sessionPath: string, name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameSession, sessionPath, name),
  getPrefs: () => ipcRenderer.invoke(IPC_CHANNELS.getPrefs),
  setPrefs: (patch: Partial<ClientPrefs>) => ipcRenderer.invoke(IPC_CHANNELS.setPrefs, patch),
  getPrefsRecoveryNotice: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getPrefsRecoveryNotice),
  checkBash: () => ipcRenderer.invoke(IPC_CHANNELS.checkBash),
  applyBashShellPath: (shellPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.applyBashShellPath, shellPath),
  pickBashShell: () => ipcRenderer.invoke(IPC_CHANNELS.pickBashShell),
  checkGit: () => ipcRenderer.invoke(IPC_CHANNELS.checkGit),
  checkAuth: () => ipcRenderer.invoke(IPC_CHANNELS.checkAuth),
  checkPiCli: () => ipcRenderer.invoke(IPC_CHANNELS.checkPiCli),
  installPiCli: () => ipcRenderer.invoke(IPC_CHANNELS.installPiCli),
  getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getStatus),
  getToolDetail: (toolCallId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getToolDetail, toolCallId),
  listProjectDir: (relPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listProjectDir, relPath),
  readProjectFile: (relPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readProjectFile, relPath),
  revealInFolder: (relPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.revealInFolder, relPath),
  // godot
  godotRpcStatus: () => ipcRenderer.invoke(IPC_CHANNELS.godotRpcStatus),
  godotRpcStart: () => ipcRenderer.invoke(IPC_CHANNELS.godotRpcStart),
  godotRpcStop: () => ipcRenderer.invoke(IPC_CHANNELS.godotRpcStop),
  godotRpcPing: () => ipcRenderer.invoke(IPC_CHANNELS.godotRpcPing),
  godotRpcRequest: (call, options) =>
    ipcRenderer.invoke(IPC_CHANNELS.godotRpcRequest, call, options),
  godotRpcSetActiveClient: (clientId) =>
    ipcRenderer.invoke(IPC_CHANNELS.godotRpcSetActiveClient, clientId),
  pickGodotEditor: () => ipcRenderer.invoke(IPC_CHANNELS.pickGodotEditor),
  launchGodotEditor: () => ipcRenderer.invoke(IPC_CHANNELS.launchGodotEditor),
  installGodotRpcAddon: () =>
    ipcRenderer.invoke(IPC_CHANNELS.installGodotRpcAddon),
  pickGodotScene: () => ipcRenderer.invoke(IPC_CHANNELS.pickGodotScene),
  godotDocsGetStatus: () => ipcRenderer.invoke(IPC_CHANNELS.godotDocsGetStatus),
  godotDocsListRemoteBranches: (force?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.godotDocsListRemoteBranches, force),
  godotDocsSetBranch: (branch: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.godotDocsSetBranch, branch),
  godotDocsOpenDownloadUrl: (branch?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.godotDocsOpenDownloadUrl, branch),
  godotDocsImportZip: (branch?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.godotDocsImportZip, branch),
  godotDocsRemoveLocal: (branch?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.godotDocsRemoveLocal, branch),
  listPlugins: (cwd) => ipcRenderer.invoke(IPC_CHANNELS.listPlugins, cwd),
  listSessionSkills: () => ipcRenderer.invoke(IPC_CHANNELS.listSessionSkills),
  readPlugin: (path) => ipcRenderer.invoke(IPC_CHANNELS.readPlugin, path),
  writePlugin: (path, content) => ipcRenderer.invoke(IPC_CHANNELS.writePlugin, path, content),
  createPlugin: (input: PluginCreateInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.createPlugin, input),
  deletePlugin: (path) => ipcRenderer.invoke(IPC_CHANNELS.deletePlugin, path),
  revealPlugin: (path) => ipcRenderer.invoke(IPC_CHANNELS.revealPlugin, path),
  reloadResources: () => ipcRenderer.invoke(IPC_CHANNELS.reloadResources),
  // providers
  listProviderProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.listProviderProfiles),
  getProviderProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.getProviderProfile, id),
  upsertProviderProfile: (input: ProviderUpsertInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.upsertProviderProfile, input),
  deleteProviderProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteProviderProfile, id),
  activateProviderProfile: (id) =>
    ipcRenderer.invoke(IPC_CHANNELS.activateProviderProfile, id),
  listProviderPresets: () => ipcRenderer.invoke(IPC_CHANNELS.listProviderPresets),
  importExistingProviderProfiles: () =>
    ipcRenderer.invoke(IPC_CHANNELS.importExistingProviderProfiles),
  fetchProviderModels: (input) => ipcRenderer.invoke(IPC_CHANNELS.fetchProviderModels, input),
  listInstalledPackages: () => ipcRenderer.invoke(IPC_CHANNELS.listInstalledPackages),
  installPackage: (source: string) => ipcRenderer.invoke(IPC_CHANNELS.installPackage, source),
  uninstallPackage: (source: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.uninstallPackage, source),
  installGodotPiPackage: () => ipcRenderer.invoke(IPC_CHANNELS.installGodotPiPackage),
  openPiLogin: () => ipcRenderer.invoke(IPC_CHANNELS.openPiLogin),
  openExternalUrl: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.openExternalUrl, url),
  getUpdateStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getUpdateStatus),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.installUpdate),
  getSessionUsage: () => ipcRenderer.invoke(IPC_CHANNELS.getSessionUsage),
  compactSession: (customInstructions?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.compactSession, customInstructions),
  getUsageSummary: (options?: { days?: number }) =>
    ipcRenderer.invoke(IPC_CHANNELS.getUsageSummary, options),
  clearUsageSummary: () => ipcRenderer.invoke(IPC_CHANNELS.clearUsageSummary),
  notifyAppReady: () => ipcRenderer.invoke(IPC_CHANNELS.appReady),
  onEvent: (handler: (event: UiAgentEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: UiAgentEvent) => {
      handler(event);
    };
    ipcRenderer.on(IPC_EVENTS.agentEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.agentEvent, listener);
    };
  },
  onUpdateStatus: (handler: (status: AppUpdateStatus) => void) => {
    const listener = (_: Electron.IpcRendererEvent, status: AppUpdateStatus) => {
      handler(status);
    };
    ipcRenderer.on(IPC_EVENTS.updateStatus, listener);
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.updateStatus, listener);
    };
  },
};

contextBridge.exposeInMainWorld("xAgent", api);
