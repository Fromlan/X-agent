import type { IpcMain } from "electron";
import type { AppAutoUpdater } from "../agent/auto-updater";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

/** Update IPC — thin forwards to AppAutoUpdater. */
export function registerUpdateIpc(
  ipcMain: IpcMain,
  updater: AppAutoUpdater,
): void {
  handle(ipcMain, IPC_CHANNELS.getUpdateStatus, async () => updater.getStatus());
  handle(ipcMain, IPC_CHANNELS.checkForUpdates, async () => updater.check());
  handle(ipcMain, IPC_CHANNELS.downloadUpdate, async () => updater.download());
  handle(ipcMain, IPC_CHANNELS.installUpdate, async () =>
    updater.quitAndInstall(),
  );
}
