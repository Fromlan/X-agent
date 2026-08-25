import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";
import { coerceSessionType, type SessionType } from "../../shared/session-type";

/** Workspace / session lifecycle IPC — thin forwards to SessionHost. */
export function registerWorkspaceIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  handle(
    ipcMain,
    IPC_CHANNELS.newSession,
    async (_e, sessionType?: unknown) =>
      sessionHost.newSession(coerceSessionType(sessionType) as SessionType),
  );
  handle(ipcMain, IPC_CHANNELS.listSessions, async () => sessionHost.listSessions());
  handle(ipcMain, IPC_CHANNELS.resumeSession, async (_e, sessionPath: string) =>
    sessionHost.resumeSession(sessionPath),
  );
  handle(ipcMain, IPC_CHANNELS.deleteSession, async (_e, sessionPath: string) =>
    sessionHost.deleteSession(sessionPath),
  );
  handle(
    ipcMain,
    IPC_CHANNELS.deleteProjectSessions,
    async (_e, projectCwd: string) => sessionHost.deleteProjectSessions(projectCwd),
  );
  handle(ipcMain, IPC_CHANNELS.closeWorkspace, async () => sessionHost.closeWorkspace());
  handle(
    ipcMain,
    IPC_CHANNELS.renameSession,
    async (_e, sessionPath: string, name: string) =>
      sessionHost.renameSession(sessionPath, name),
  );
  handle(ipcMain, IPC_CHANNELS.getStatus, async () => sessionHost.getStatus());
}
