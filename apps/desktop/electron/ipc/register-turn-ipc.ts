import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import { IPC_CHANNELS } from "../../shared/ipc-channels";

/** Turn / retract IPC — thin forwards to SessionHost. */
export function registerTurnIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  ipcMain.handle(IPC_CHANNELS.prompt, async (_e, text: string) =>
    sessionHost.prompt(text),
  );
  ipcMain.handle(IPC_CHANNELS.abort, async () => sessionHost.abort());
  ipcMain.handle(IPC_CHANNELS.previewRetract, async (_e, entryId: string) =>
    sessionHost.previewRetract(entryId),
  );
  ipcMain.handle(
    IPC_CHANNELS.retractToUserMessage,
    async (_e, entryId: string, options?: { undoFiles?: boolean }) =>
      sessionHost.retractToUserMessage(entryId, options),
  );
  ipcMain.handle(
    IPC_CHANNELS.editAndResend,
    async (
      _e,
      entryId: string,
      text: string,
      options?: { undoFiles?: boolean },
    ) => sessionHost.editAndResend(entryId, text, options),
  );
  ipcMain.handle(
    IPC_CHANNELS.regenerateFromUser,
    async (_e, entryId: string, options?: { undoFiles?: boolean }) =>
      sessionHost.regenerateFromUser(entryId, options),
  );
}
