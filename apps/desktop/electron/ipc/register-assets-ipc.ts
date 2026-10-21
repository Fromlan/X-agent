/** Register aggregate usage endpoints independently of per-session accounting. */
import type { IpcMain } from "electron";
import { clearUsageSummary, getUsageSummary } from "../agent/usage-store";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

/** Usage operations retain the shared sender guard and atomic store implementation. */
export function registerAssetsIpc(ipcMain: IpcMain): void {
  handle(ipcMain, IPC_CHANNELS.getUsageSummary, async (_e, options?: { days?: number }) =>
    await getUsageSummary(options),
  );
  handle(ipcMain, IPC_CHANNELS.clearUsageSummary, async () => await clearUsageSummary());
}
