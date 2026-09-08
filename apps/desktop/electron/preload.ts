import { contextBridge, ipcRenderer } from "electron";
import { DELETED_FLAT_KEYS } from "../shared/ipc";
import type {
  AppUpdateStatus,
  DeletedFlatKey,
  FlatInvokeApi,
  IpcChannelKey,
  IpcInvokeMap,
  PromptPayload,
  UiAgentEvent,
  XAgentApi,
  XAgentApiFlat,
} from "../shared/ipc";
import { IPC_CHANNELS, IPC_EVENTS } from "../shared/ipc-channels";
import { dbgLog, dbgTimer } from "../shared/debug-log";
import { mountXAgentPath } from "./preload-path-helper";

/**
 * Builds the invoke surface for every channel from the single source of truth
 * (IPC_CHANNELS + IpcInvokeMap). The generated methods are plain
 * `(...args) => ipcRenderer.invoke(channel, ...args)` forwards; key name ==
 * channel name is guaranteed by the compile-time coverage gate in shared/ipc.ts.
 *
 * **Sender-trust 透传契约 (issue #65 主题 H, 2026-08-31)**:
 * 不可信 sender 抛的 `SenderUntrustedError` 是 main 端 `ipcMain.handle` 抛出,
 * IPC 协议把它序列化进 reject payload, 这里的 forwarder **不 catch 不 wrap**,
 * 让它原样作为 rejected promise 传到 renderer 端 `await` 的 catch 块.
 * 渲染端用 `isSenderUntrustedError(e)` typeguard 区分业务错误.
 *
 * 这是 forwarder 必须保持的最小契约: 一旦 wrap 成 `throw new Error(...)`,
 * SenderUntrustedError tag 与 channel 字段都会丢, 渲染端退化到不能区分 sender
 * 不可信 vs 业务错误.
 */
function makeInvokeApi(): FlatInvokeApi {
  const api = {} as FlatInvokeApi;
  // Index assignment through the mapped type is conservative (intersection);
  // write via a record whose value type does not depend on the key.
  const writer = api as Record<IpcChannelKey, IpcInvokeMap[IpcChannelKey]>;
  for (const key of Object.keys(IPC_CHANNELS)) {
    const channelKey = key as IpcChannelKey;
    // 故意吞下 catch: ipcRenderer.invoke 的 reject 必须透传到 renderer 端,
    // 这里 wrap 会破坏 SenderUntrustedError 契约.
    const invoke: IpcInvokeMap[IpcChannelKey] = ((...args: unknown[]) =>
      ipcRenderer.invoke(channelKey, ...args)) as IpcInvokeMap[IpcChannelKey];
    writer[channelKey] = invoke;
  }
  return api;
}

const api = makeInvokeApi();

// Channel-keyed methods that keep custom logging on the renderer side.
api.prompt = ((payload: PromptPayload) => {
  dbgLog("preload", "invoke prompt", {
    textLen: payload?.text?.length,
    imageCount: payload?.images?.length ?? 0,
  });
  // #42 调试可见性:DevTools Console 立刻看到图片是否进入 IPC,免去翻
  // dbgLog 的麻烦。生产环境 DevTools 默认关闭,但用户主动打开即可核对。
  console.info(
    `[x-agent] prompt: ${payload?.images?.length ?? 0} image(s), ${payload?.text?.length ?? 0} char(s)`,
  );
  const done = dbgTimer("preload", "prompt roundtrip");
  return ipcRenderer.invoke(IPC_CHANNELS.prompt, payload).then((result) => {
    done();
    dbgLog("preload", "prompt result", result);
    return result;
  });
}) as IpcInvokeMap["prompt"];

/** Flat surface: generated invoke methods minus the facade-covered ones. */
const flatApi: XAgentApiFlat = {
  ...pickInvokeApi(api),
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

function pickInvokeApi(source: FlatInvokeApi): Omit<FlatInvokeApi, DeletedFlatKey> {
  const kept = {} as FlatInvokeApi;
  const writer = kept as Record<keyof FlatInvokeApi, IpcInvokeMap[IpcChannelKey]>;
  const deleted = DELETED_FLAT_KEYS as readonly string[];
  for (const key of Object.keys(source)) {
    if (!deleted.includes(key)) {
      writer[key as keyof FlatInvokeApi] = source[key as keyof FlatInvokeApi];
    }
  }
  return kept as Omit<FlatInvokeApi, DeletedFlatKey>;
}

const exposed: XAgentApi = {
  ...flatApi,
  workspace: {
    open: api.openProject,
    close: api.closeWorkspace,
    newSession: api.newSession,
    resume: api.resumeSession,
    listSessions: api.listSessions,
    deleteSession: api.deleteSession,
    deleteProjectSessions: api.deleteProjectSessions,
    renameSession: api.renameSession,
    getStatus: api.getStatus,
  },
  turn: {
    prompt: api.prompt,
    abort: api.abort,
    previewRetract: api.previewRetract,
    retract: api.retractToUserMessage,
    editAndResend: api.editAndResend,
    regenerate: api.regenerateFromUser,
  },
  plan: {
    setMode: api.setSessionMode,
    getMode: api.getSessionMode,
    build: api.buildPlan,
    getContent: api.getPlanContent,
    saveContent: api.savePlanContent,
    saveToWorkspace: api.savePlanToWorkspace,
    clear: api.clearPlan,
    setGoal: api.setGoal,
    pauseGoal: api.pauseGoal,
    resumeGoal: api.resumeGoal,
    clearGoal: api.clearGoal,
    getGoal: api.getGoal,
  },
  session: {
    setModel: api.setModel,
    setThinkingLevel: api.setThinkingLevel,
    listModels: api.listModels,
    getSessionUsage: api.getSessionUsage,
    compactSession: api.compactSession,
    getToolDetail: api.getToolDetail,
    reloadResources: api.reloadResources,
    listSessionSlashItems: api.listSessionSlashItems,
  },
  prefs: {
    get: api.getPrefs,
    set: api.setPrefs,
    getRecoveryNotice: api.getPrefsRecoveryNotice,
    getSecretCodecStatus: api.getSecretCodecStatus,
    checkBash: api.checkBash,
    checkBashLiveness: api.checkBashLiveness,
    applyBashShellPath: api.applyBashShellPath,
    pickBashShell: api.pickBashShell,
    checkGit: api.checkGit,
    checkAuth: api.checkAuth,
    checkPiCli: api.checkPiCli,
    installPiCli: api.installPiCli,
  },
  appReport: {
    getStartupReport: api.getStartupReport,
  },
  godot: {
    status: api.godotRpcStatus,
    start: api.godotRpcStart,
    stop: api.godotRpcStop,
    ping: api.godotRpcPing,
    request: api.godotRpcRequest,
    setActiveClient: api.godotRpcSetActiveClient,
    installAddon: api.installGodotRpcAddon,
    launchEditor: api.launchGodotEditor,
    pickEditor: api.pickGodotEditor,
    pickScene: api.pickGodotScene,
  },
  updates: {
    getStatus: api.getUpdateStatus,
    check: api.checkForUpdates,
    download: api.downloadUpdate,
    install: api.installUpdate,
    onStatus: flatApi.onUpdateStatus,
  },
  logo: {
    listPresets: api.logoListPresets,
    uploadCustom: api.logoUploadCustom,
    clearCustom: api.logoClearCustom,
    onChanged: (handler: (payload: { id: string }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: { id: string }) => {
        handler(payload);
      };
      ipcRenderer.on(IPC_EVENTS.logoChanged, listener);
      return () => {
        ipcRenderer.removeListener(IPC_EVENTS.logoChanged, listener);
      };
    },
  },
} as XAgentApi;

contextBridge.exposeInMainWorld("xAgent", exposed);

// Drag-and-drop helper: Electron 32+ no longer augments File with `.path`
// (security: cross-origin drag). Renderer 进程需要走 webUtils.getPathForFile
// 拿绝对路径, 用于 @<path> 引用 / cwd-sandbox resolve. Expose it via
// contextBridge so the sandboxed renderer can call it without importing
// 'electron' directly.
//
// 实现抽到 ./preload-path-helper.ts (issue #60 主题 D C-304, 2026-08-31):
// preload.ts 只剩 1 个 global (xAgent) + 1 行 mount 调用. 测试可以 mock
// helper 不必走真实 contextBridge.
mountXAgentPath();
