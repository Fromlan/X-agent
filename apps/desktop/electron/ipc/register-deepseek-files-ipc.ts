/** Expose explicit file uploads through the same trusted-sender boundary as other project operations. */
import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import type { DeepSeekFileUploadInput, DeepSeekFileUploadResult } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { uploadDeepSeekFile } from "../agent/deepseek-files";
import { handle } from "./register-ipc";

/** Keep file bytes in the explicit upload call and return only scoped document references. */
export function registerDeepSeekFilesIpc(ipcMain: IpcMain, sessionHost: SessionHost): void {
  handle(ipcMain, IPC_CHANNELS.deepseekUploadFile, async (_event, input: DeepSeekFileUploadInput): Promise<DeepSeekFileUploadResult> => {
    try {
      const document = await uploadDeepSeekFile(sessionHost, input);
      return { ok: true, document };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "DeepSeek 文件上传失败，请重试。" };
    }
  });
}
