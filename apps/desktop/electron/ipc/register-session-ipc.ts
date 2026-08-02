import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import { registerWorkspaceIpc } from "./register-workspace-ipc";
import { registerTurnIpc } from "./register-turn-ipc";
import { registerPlanIpc } from "./register-plan-ipc";
import { registerSessionConfigIpc } from "./register-session-config-ipc";

/** Session-related IPC — composes workspace / turn / plan / config registrars. */
export function registerSessionIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  registerWorkspaceIpc(ipcMain, sessionHost);
  registerTurnIpc(ipcMain, sessionHost);
  registerPlanIpc(ipcMain, sessionHost);
  registerSessionConfigIpc(ipcMain, sessionHost);
}
