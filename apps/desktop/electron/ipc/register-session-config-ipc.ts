import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import type { ThinkingLevel } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";
import { dbgLog } from "../../shared/debug-log";

/** Session tuning / usage / resources IPC — thin forwards to SessionHost. */
export function registerSessionConfigIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  handle(ipcMain, IPC_CHANNELS.setModel, async (_e, provider: string, id: string) => {
    // DEBUG(thinking-switch #30): IPC 入口,确认 renderer 实际下发到主进程
    dbgLog("ipc", "setModel invoke", { provider, id });
    return sessionHost.setModel(provider, id);
  });
  handle(ipcMain, IPC_CHANNELS.setThinkingLevel, async (_e, level: ThinkingLevel) => {
    // DEBUG(thinking-switch #30): IPC 入口,确认 composer 点选确实到达主进程
    dbgLog("ipc", "setThinkingLevel invoke", { level });
    return sessionHost.setThinkingLevel(level);
  });
  handle(ipcMain, IPC_CHANNELS.listModels, async () => sessionHost.listModels());
  handle(ipcMain, IPC_CHANNELS.getToolDetail, async (_e, toolCallId: string) =>
    sessionHost.getToolDetail(toolCallId),
  );
  handle(ipcMain, IPC_CHANNELS.getSessionUsage, async () =>
    sessionHost.getSessionUsage(),
  );
  handle(
    ipcMain,
    IPC_CHANNELS.compactSession,
    async (_e, customInstructions?: string) =>
      sessionHost.compactSession(customInstructions),
  );
  handle(ipcMain, IPC_CHANNELS.reloadResources, async () =>
    sessionHost.reloadResources(),
  );
}
