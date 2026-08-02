import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import { IPC_CHANNELS } from "../../shared/ipc-channels";

/** Workspace / session lifecycle IPC — thin forwards to SessionHost. */
export function registerWorkspaceIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  ipcMain.handle(IPC_CHANNELS.newSession, async () => sessionHost.newSession());
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
}
