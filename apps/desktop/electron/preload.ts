import { contextBridge, ipcRenderer } from "electron";
import type {
  XAgentApi,
  ClientPrefs,
  PluginCreateInput,
  ProviderUpsertInput,
  ThinkingLevel,
  UiAgentEvent,
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
  getStatus: () => ipcRenderer.invoke("getStatus"),
  fleetList: () => ipcRenderer.invoke("fleetList"),
  fleetCreate: (label, role) => ipcRenderer.invoke("fleetCreate", label, role),
  fleetSetActive: (id) => ipcRenderer.invoke("fleetSetActive", id),
  godotRpcStatus: () => ipcRenderer.invoke("godotRpcStatus"),
  godotRpcStart: () => ipcRenderer.invoke("godotRpcStart"),
  godotRpcStop: () => ipcRenderer.invoke("godotRpcStop"),
  godotRpcPing: () => ipcRenderer.invoke("godotRpcPing"),
  godotRpcRequest: (call) => ipcRenderer.invoke("godotRpcRequest", call),
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
  onEvent: (handler: (event: UiAgentEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: UiAgentEvent) => {
      handler(event);
    };
    ipcRenderer.on("agent:event", listener);
    return () => {
      ipcRenderer.removeListener("agent:event", listener);
    };
  },
};

contextBridge.exposeInMainWorld("xAgent", api);
