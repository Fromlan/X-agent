import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import type { ThinkingLevel } from "../../shared/ipc";

/** Session / workspace IPC — thin forwards to SessionHost. */
export function registerSessionIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  ipcMain.handle("prompt", async (_e, text: string) => sessionHost.prompt(text));
  ipcMain.handle("abort", async () => sessionHost.abort());
  ipcMain.handle("previewRetract", async (_e, entryId: string) =>
    sessionHost.previewRetract(entryId),
  );
  ipcMain.handle(
    "retractToUserMessage",
    async (_e, entryId: string, options?: { undoFiles?: boolean }) =>
      sessionHost.retractToUserMessage(entryId, options),
  );
  ipcMain.handle(
    "editAndResend",
    async (
      _e,
      entryId: string,
      text: string,
      options?: { undoFiles?: boolean },
    ) => sessionHost.editAndResend(entryId, text, options),
  );
  ipcMain.handle(
    "regenerateFromUser",
    async (_e, entryId: string, options?: { undoFiles?: boolean }) =>
      sessionHost.regenerateFromUser(entryId, options),
  );
  ipcMain.handle("newSession", async () => sessionHost.newSession());
  ipcMain.handle("setModel", async (_e, provider: string, id: string) =>
    sessionHost.setModel(provider, id),
  );
  ipcMain.handle("setThinkingLevel", async (_e, level: ThinkingLevel) =>
    sessionHost.setThinkingLevel(level),
  );
  ipcMain.handle("listModels", async () => sessionHost.listModels());
  ipcMain.handle("listSessions", async () => sessionHost.listSessions());
  ipcMain.handle("resumeSession", async (_e, sessionPath: string) =>
    sessionHost.resumeSession(sessionPath),
  );
  ipcMain.handle("deleteSession", async (_e, sessionPath: string) =>
    sessionHost.deleteSession(sessionPath),
  );
  ipcMain.handle("deleteProjectSessions", async (_e, projectCwd: string) =>
    sessionHost.deleteProjectSessions(projectCwd),
  );
  ipcMain.handle("closeWorkspace", async () => sessionHost.closeWorkspace());
  ipcMain.handle("renameSession", async (_e, sessionPath: string, name: string) =>
    sessionHost.renameSession(sessionPath, name),
  );
  ipcMain.handle("getStatus", async () => sessionHost.getStatus());
  ipcMain.handle("getToolDetail", async (_e, toolCallId: string) =>
    sessionHost.getToolDetail(toolCallId),
  );
  ipcMain.handle("getSessionUsage", async () => sessionHost.getSessionUsage());
  ipcMain.handle("compactSession", async (_e, customInstructions?: string) =>
    sessionHost.compactSession(customInstructions),
  );
  ipcMain.handle("reloadResources", async () => sessionHost.reloadResources());
}
