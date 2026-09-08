/**
 * IPC handler composition root (主题 E #62 拆分, 2026-09-08).
 *
 * 把 8 类 registerXxxIpc 收敛为一行 `registerIpcHandlers(deps)` 调用,
 * app-runtime.ts 的 `registerIpc()` 旧 god function 不再保留.
 *
 * 启动期 sender 守卫 (configureIpcSenderGuard) 也在这里集中配置.
 */
import type { IpcMain, BrowserWindow } from "electron";
import type { SessionHost } from "../agent/session-host";
import type { GodotRpcBridge } from "../agent/godot-rpc-bridge";
import type { AppAutoUpdater } from "../agent/auto-updater";
import type { PrefsRecoveryNotice } from "../agent/prefs";
import type { StartupIssue } from "../boot/startup-issues";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import type { ClientPrefs } from "../../shared/ipc";
import { configureIpcSenderGuard } from "./register-ipc";
import { registerCoreIpc } from "./register-core-ipc";
import { registerPrefsIpc } from "./register-prefs-ipc";
import { registerBashIpc } from "./register-bash-ipc";
import { registerEnvIpc } from "./register-env-ipc";
import { registerProjectFsIpc } from "./register-project-fs-ipc";
import { registerPluginIpc } from "./register-plugin-ipc";
import { registerPackageIpc } from "./register-package-ipc";
import { registerAssetsIpc } from "./register-assets-ipc";
import { registerWorkspaceIpc } from "./register-workspace-ipc";
import { registerTurnIpc } from "./register-turn-ipc";
import { registerPlanIpc } from "./register-plan-ipc";
import { registerSessionConfigIpc } from "./register-session-config-ipc";
import { registerProviderIpc } from "./register-provider-ipc";
import { registerGodotIpc } from "./register-godot-ipc";
import { registerUpdateIpc } from "./register-update-ipc";

export type RegisterIpcDeps = {
  ipcMain: IpcMain;
  sessionHost: SessionHost;
  godotRpc: GodotRpcBridge;
  updater: AppAutoUpdater;
  getMainWindow: () => BrowserWindow | null;
  revealMainWindow: () => void;
  openExternalHttpUrl: (
    url: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  // Prefs port (issue #62 主题 E-3, 显式注入而非 module-singleton)
  loadPrefs: () => ClientPrefs;
  patchPrefs: (patch: Partial<ClientPrefs>) => Promise<ClientPrefs>;
  getCachedPrefs: () => ClientPrefs;
  notifyLogoChange: (id: string, win: BrowserWindow | null) => void;
  // 启动期一次性 queue
  consumePrefsRecoveryNotice: () => PrefsRecoveryNotice | null;
  consumeStartupIssues: () => StartupIssue[];
};

/**
 * 一行接线: 8 类 registerXxxIpc + 9 类 registerYyyIpc (workspace/turn/plan/...
 * 由之前 wave 完成). 配置 IPC sender 守卫后, 各模块只关心自己的 channel 集合.
 */
export function registerIpcHandlers(deps: RegisterIpcDeps): void {
  const {
    ipcMain,
    sessionHost,
    godotRpc,
    updater,
    getMainWindow,
    revealMainWindow,
    openExternalHttpUrl,
  } = deps;

  // 统一 IPC sender 守卫: 仅主窗口 webContents 可调用任何 channel.
  configureIpcSenderGuard(
    getMainWindow,
    process.env.ELECTRON_RENDERER_URL ?? null,
  );

  // session / workspace / turn / plan / provider / godot / update — 由之前 wave
  // 拆出, 这里只是再串起来.
  registerWorkspaceIpc(ipcMain, sessionHost);
  registerTurnIpc(ipcMain, sessionHost);
  registerPlanIpc(ipcMain, sessionHost);
  registerSessionConfigIpc(ipcMain, sessionHost);
  registerProviderIpc(ipcMain, sessionHost);
  registerGodotIpc(ipcMain, sessionHost, godotRpc);

  // 主题 E #62 拆出的 8 类.
  registerCoreIpc(ipcMain, {
    sessionHost,
    openExternalHttpUrl,
    revealMainWindow,
    consumePrefsRecoveryNotice: deps.consumePrefsRecoveryNotice,
    consumeStartupIssues: deps.consumeStartupIssues,
  });
  registerPrefsIpc(ipcMain, {
    loadPrefs: deps.loadPrefs,
    patchPrefs: deps.patchPrefs,
    getCachedPrefs: deps.getCachedPrefs,
    applyTools: (tools) => sessionHost.applyTools(tools),
    reloadResources: () => sessionHost.reloadResources(),
    notifyLogoChange: deps.notifyLogoChange,
    getMainWindow,
  });
  registerBashIpc(ipcMain);
  registerEnvIpc(ipcMain);
  registerProjectFsIpc(ipcMain, sessionHost);
  registerPluginIpc(ipcMain, sessionHost);
  registerPackageIpc(ipcMain, sessionHost);
  registerAssetsIpc(ipcMain, {
    getCachedPrefs: deps.getCachedPrefs,
    getMainWindow,
  });
  registerUpdateIpc(ipcMain, updater);
}
