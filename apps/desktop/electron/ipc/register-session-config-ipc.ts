import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import type { ThinkingLevel } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";

/** Session tuning / usage / resources IPC — thin forwards to SessionHost. */
export function registerSessionConfigIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  ipcMain.handle(IPC_CHANNELS.setModel, async (_e, provider: string, id: string) =>
    sessionHost.setModel(provider, id),
  );
  ipcMain.handle(IPC_CHANNELS.setThinkingLevel, async (_e, level: ThinkingLevel) =>
    sessionHost.setThinkingLevel(level),
  );
  ipcMain.handle(IPC_CHANNELS.listModels, async () => sessionHost.listModels());
  ipcMain.handle(IPC_CHANNELS.getToolDetail, async (_e, toolCallId: string) =>
    sessionHost.getToolDetail(toolCallId),
  );
  ipcMain.handle(IPC_CHANNELS.getSessionUsage, async () =>
    sessionHost.getSessionUsage(),
  );
  ipcMain.handle(IPC_CHANNELS.compactSession, async (_e, customInstructions?: string) =>
    sessionHost.compactSession(customInstructions),
  );
  ipcMain.handle(IPC_CHANNELS.reloadResources, async () =>
    sessionHost.reloadResources(),
  );
}
