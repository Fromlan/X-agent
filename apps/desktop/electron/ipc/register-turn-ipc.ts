import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import type { PromptPayload } from "../../shared/ipc";
import { dbgLog, dbgTimer } from "../../shared/debug-log";
import { handle } from "./register-ipc";

/** Turn / retract IPC — thin forwards to SessionHost. */

/** E2: 单条 prompt 上限（数 MB 文本会撑爆会话序列化与 API 请求）。 */
export const PROMPT_MAX_LENGTH = 512_000;

export function registerTurnIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  handle(ipcMain, IPC_CHANNELS.prompt, async (_e, payload: PromptPayload) => {
    const text = payload?.text ?? "";
    if (typeof text !== "string" || text.length > PROMPT_MAX_LENGTH) {
      return { ok: false, error: `消息过长（上限 ${PROMPT_MAX_LENGTH} 字符）` };
    }
    dbgLog("ipc", "prompt handler entered", {
      len: text.length,
      imageCount: payload?.images?.length ?? 0,
    });
    const done = dbgTimer("ipc", "prompt handler");
    try {
      const result = await sessionHost.prompt(payload);
      done();
      dbgLog("ipc", "prompt handler result", { ok: result.ok, silent: result.silent, error: result.error });
      return result;
    } catch (err) {
      dbgLog("ipc", "prompt handler threw", err instanceof Error ? err.message : String(err));
      throw err;
    }
  });
  handle(ipcMain, IPC_CHANNELS.abort, async () => {
    dbgLog("ipc", "abort handler entered");
    const done = dbgTimer("ipc", "abort handler");
    const result = await sessionHost.abort();
    done();
    dbgLog("ipc", "abort handler result", { ok: result.ok });
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.previewRetract, async (_e, entryId: string) =>
    sessionHost.previewRetract(entryId),
  );
  handle(
    ipcMain,
    IPC_CHANNELS.retractToUserMessage,
    async (_e, entryId: string, options?: { undoFiles?: boolean }) =>
      sessionHost.retractToUserMessage(entryId, options),
  );
  handle(
    ipcMain,
    IPC_CHANNELS.editAndResend,
    async (
      _e,
      entryId: string,
      text: string,
      options?: { undoFiles?: boolean },
    ) => sessionHost.editAndResend(entryId, text, options),
  );
  handle(
    ipcMain,
    IPC_CHANNELS.regenerateFromUser,
    async (_e, entryId: string, options?: { undoFiles?: boolean }) =>
      sessionHost.regenerateFromUser(entryId, options),
  );
}
