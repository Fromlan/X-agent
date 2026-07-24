import { contextBridge, ipcRenderer } from "electron";
import type {
  AppUpdateStatus,
  XAgentApi,
  ClientPrefs,
  FleetUiEvent,
  PluginCreateInput,
  ProviderUpsertInput,
  SlotAgentEvent,
  ThinkingLevel,
} from "../shared/ipc";

const api: XAgentApi = {
  openProject: (path?: string) => ipcRenderer.invoke("openProject", path),
  prompt: (text: string) => ipcRenderer.invoke("prompt", text),
  abort: () => ipcRenderer.invoke("abort"),
  newSession: () => ipcRenderer.invoke("newSession"),
  setModel: (provider: string, id: string) =>
    ipcRenderer.invoke("setModel", provider, id),
  setThinkingLevel: (level: ThinkingLevel) =>
    ipcRenderer.invoke("setThinkingLevel", level),
  listModels: () => ipcRenderer.invoke("listModels"),
  listSessions: () => ipcRenderer.invoke("listSessions"),
  resumeSession: (sessionPath: string) =>
    ipcRenderer.invoke("resumeSession", sessionPath),
  deleteSession: (sessionPath: string) =>
    ipcRenderer.invoke("deleteSession", sessionPath),
  renameSession: (sessionPath: string, name: string) =>
    ipcRenderer.invoke("renameSession", sessionPath, name),
  getPrefs: () => ipcRenderer.invoke("getPrefs"),
  setPrefs: (patch: Partial<ClientPrefs>) => ipcRenderer.invoke("setPrefs", patch),
  checkBash: () => ipcRenderer.invoke("checkBash"),
  applyBashShellPath: (shellPath?: string) =>
    ipcRenderer.invoke("applyBashShellPath", shellPath),
  pickBashShell: () => ipcRenderer.invoke("pickBashShell"),
  checkAuth: () => ipcRenderer.invoke("checkAuth"),
  checkPiCli: () => ipcRenderer.invoke("checkPiCli"),
  installPiCli: () => ipcRenderer.invoke("installPiCli"),
  getStatus: () => ipcRenderer.invoke("getStatus"),
  fleetList: () => ipcRenderer.invoke("fleetList"),
  fleetState: () => ipcRenderer.invoke("fleetState"),
  fleetCreate: (label, role) => ipcRenderer.invoke("fleetCreate", label, role),
  fleetSetActive: (id) => ipcRenderer.invoke("fleetSetActive", id),
  fleetRemove: (id) => ipcRenderer.invoke("fleetRemove", id),
  fleetStartPair: (task) => ipcRenderer.invoke("fleetStartPair", task),
  fleetAbortPair: () => ipcRenderer.invoke("fleetAbortPair"),
  godotRpcStatus: () => ipcRenderer.invoke("godotRpcStatus"),
  godotRpcStart: () => ipcRenderer.invoke("godotRpcStart"),
  godotRpcStop: () => ipcRenderer.invoke("godotRpcStop"),
  godotRpcPing: () => ipcRenderer.invoke("godotRpcPing"),
  godotRpcRequest: (call, options) =>
    ipcRenderer.invoke("godotRpcRequest", call, options),
  godotRpcSetActiveClient: (clientId) =>
    ipcRenderer.invoke("godotRpcSetActiveClient", clientId),
  pickGodotEditor: () => ipcRenderer.invoke("pickGodotEditor"),
  launchGodotEditor: () => ipcRenderer.invoke("launchGodotEditor"),
  installGodotRpcAddon: () =>
    ipcRenderer.invoke("installGodotRpcAddon"),
  pickGodotScene: () => ipcRenderer.invoke("pickGodotScene"),
  listPlugins: (cwd) => ipcRenderer.invoke("listPlugins", cwd),
  readPlugin: (path) => ipcRenderer.invoke("readPlugin", path),
  writePlugin: (path, content) => ipcRenderer.invoke("writePlugin", path, content),
  createPlugin: (input: PluginCreateInput) =>
    ipcRenderer.invoke("createPlugin", input),
  deletePlugin: (path) => ipcRenderer.invoke("deletePlugin", path),
  revealPlugin: (path) => ipcRenderer.invoke("revealPlugin", path),
  reloadResources: () => ipcRenderer.invoke("reloadResources"),
  listProviderProfiles: () => ipcRenderer.invoke("listProviderProfiles"),
  getProviderProfile: (id) => ipcRenderer.invoke("getProviderProfile", id),
  upsertProviderProfile: (input: ProviderUpsertInput) =>
    ipcRenderer.invoke("upsertProviderProfile", input),
  deleteProviderProfile: (id) => ipcRenderer.invoke("deleteProviderProfile", id),
  activateProviderProfile: (id) =>
    ipcRenderer.invoke("activateProviderProfile", id),
  listProviderPresets: () => ipcRenderer.invoke("listProviderPresets"),
  importExistingProviderProfiles: () =>
    ipcRenderer.invoke("importExistingProviderProfiles"),
  fetchProviderModels: (input) => ipcRenderer.invoke("fetchProviderModels", input),
  listInstalledPackages: () => ipcRenderer.invoke("listInstalledPackages"),
  installPackage: (source: string) => ipcRenderer.invoke("installPackage", source),
  removePackageRecord: (name: string) =>
    ipcRenderer.invoke("removePackageRecord", name),
  installGodotPiPackage: () => ipcRenderer.invoke("installGodotPiPackage"),
  openPiLogin: () => ipcRenderer.invoke("openPiLogin"),
  getUpdateStatus: () => ipcRenderer.invoke("getUpdateStatus"),
  checkForUpdates: () => ipcRenderer.invoke("checkForUpdates"),
  downloadUpdate: () => ipcRenderer.invoke("downloadUpdate"),
  installUpdate: () => ipcRenderer.invoke("installUpdate"),
  onEvent: (handler: (payload: SlotAgentEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: SlotAgentEvent) => {
      handler(payload);
    };
    ipcRenderer.on("agent:event", listener);
    return () => {
      ipcRenderer.removeListener("agent:event", listener);
    };
  },
  onFleetEvent: (handler: (event: FleetUiEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: FleetUiEvent) => {
      handler(event);
    };
    ipcRenderer.on("fleet:event", listener);
    return () => {
      ipcRenderer.removeListener("fleet:event", listener);
    };
  },
  onUpdateStatus: (handler: (status: AppUpdateStatus) => void) => {
    const listener = (_: Electron.IpcRendererEvent, status: AppUpdateStatus) => {
      handler(status);
    };
    ipcRenderer.on("update:status", listener);
    return () => {
      ipcRenderer.removeListener("update:status", listener);
    };
  },
};

contextBridge.exposeInMainWorld("xAgent", api);
