import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import type { ThinkingLevel } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";

/** Session / workspace IPC — thin forwards to SessionHost. */
export function registerSessionIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  ipcMain.handle(IPC_CHANNELS.prompt, async (_e, text: string) => sessionHost.prompt(text));
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
  ipcMain.handle(IPC_CHANNELS.newSession, async () => sessionHost.newSession());
  ipcMain.handle(IPC_CHANNELS.setModel, async (_e, provider: string, id: string) =>
    sessionHost.setModel(provider, id),
  );
  ipcMain.handle(IPC_CHANNELS.setThinkingLevel, async (_e, level: ThinkingLevel) =>
    sessionHost.setThinkingLevel(level),
  );
  ipcMain.handle(IPC_CHANNELS.listModels, async () => sessionHost.listModels());
  ipcMain.handle(IPC_CHANNELS.listSessions, async () => sessionHost.listSessions());
  ipcMain.handle(IPC_CHANNELS.resumeSession, async (_e, sessionPath: string) =>
    sessionHost.resumeSession(sessionPath),
  );
  ipcMain.handle(IPC_CHANNELS.deleteSession, async (_e, sessionPath: string) =>
    sessionHost.deleteSession(sessionPath),
  );
  ipcMain.handle(IPC_CHANNELS.deleteProjectSessions, async (_e, projectCwd: string) =>
    sessionHost.deleteProjectSessions(projectCwd),
  );
  ipcMain.handle(IPC_CHANNELS.closeWorkspace, async () => sessionHost.closeWorkspace());
  ipcMain.handle(IPC_CHANNELS.renameSession, async (_e, sessionPath: string, name: string) =>
    sessionHost.renameSession(sessionPath, name),
  );
  ipcMain.handle(IPC_CHANNELS.getStatus, async () => sessionHost.getStatus());
  ipcMain.handle(IPC_CHANNELS.getToolDetail, async (_e, toolCallId: string) =>
    sessionHost.getToolDetail(toolCallId),
  );
  ipcMain.handle(IPC_CHANNELS.getSessionUsage, async () => sessionHost.getSessionUsage());
  ipcMain.handle(IPC_CHANNELS.compactSession, async (_e, customInstructions?: string) =>
    sessionHost.compactSession(customInstructions),
  );
  ipcMain.handle(IPC_CHANNELS.reloadResources, async () => sessionHost.reloadResources());
}
