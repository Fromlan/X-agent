import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { dbgLog, dbgTimer } from "../../shared/debug-log";

/** Turn / retract IPC — thin forwards to SessionHost. */
export function registerTurnIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  ipcMain.handle(IPC_CHANNELS.prompt, async (_e, text: string) => {
    dbgLog("ipc", "prompt handler entered", { len: text?.length });
    const done = dbgTimer("ipc", "prompt handler");
    try {
      const result = await sessionHost.prompt(text);
      done();
      dbgLog("ipc", "prompt handler result", { ok: result.ok, silent: result.silent, error: result.error });
      return result;
    } catch (err) {
      dbgLog("ipc", "prompt handler threw", err instanceof Error ? err.message : String(err));
      throw err;
    }
  });
  ipcMain.handle(IPC_CHANNELS.abort, async () => {
    dbgLog("ipc", "abort handler entered");
    const done = dbgTimer("ipc", "abort handler");
    const result = await sessionHost.abort();
    done();
    dbgLog("ipc", "abort handler result", { ok: result.ok });
    return result;
  });
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
