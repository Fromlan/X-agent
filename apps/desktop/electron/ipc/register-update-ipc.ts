import type { IpcMain } from "electron";
import type { AppAutoUpdater } from "../agent/auto-updater";
import { IPC_CHANNELS } from "../../shared/ipc-channels";

/** Update IPC — thin forwards to AppAutoUpdater. */
export function registerUpdateIpc(
  ipcMain: IpcMain,
  updater: AppAutoUpdater,
): void {
  ipcMain.handle(IPC_CHANNELS.getUpdateStatus, async () => updater.getStatus());
  ipcMain.handle(IPC_CHANNELS.checkForUpdates, async () => updater.check());
  ipcMain.handle(IPC_CHANNELS.downloadUpdate, async () => updater.download());
  ipcMain.handle(IPC_CHANNELS.installUpdate, async () =>
    updater.quitAndInstall(),
  );
}
