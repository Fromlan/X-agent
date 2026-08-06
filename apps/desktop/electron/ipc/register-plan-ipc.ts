import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import type { AgentSessionMode } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

/** Plan / goal / session-mode IPC — thin forwards to SessionHost. */
export function registerPlanIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  handle(ipcMain, IPC_CHANNELS.setSessionMode, async (_e, mode: AgentSessionMode) =>
    sessionHost.setSessionMode(mode),
  );
  handle(ipcMain, IPC_CHANNELS.getSessionMode, async () =>
    sessionHost.getSessionMode(),
  );
  handle(ipcMain, IPC_CHANNELS.buildPlan, async () => sessionHost.buildPlan());
  handle(ipcMain, IPC_CHANNELS.getPlanContent, async () =>
    sessionHost.getPlanContent(),
  );
  handle(ipcMain, IPC_CHANNELS.savePlanContent, async (_e, markdown: string) =>
    sessionHost.savePlanContent(markdown),
  );
  handle(ipcMain, IPC_CHANNELS.savePlanToWorkspace, async () =>
    sessionHost.savePlanToWorkspace(),
  );
  handle(ipcMain, IPC_CHANNELS.clearPlan, async () => sessionHost.clearPlan());
  handle(ipcMain, IPC_CHANNELS.setGoal, async (_e, condition: string) =>
    sessionHost.setGoal(condition),
  );
  handle(ipcMain, IPC_CHANNELS.pauseGoal, async () => sessionHost.pauseGoal());
  handle(ipcMain, IPC_CHANNELS.resumeGoal, async () => sessionHost.resumeGoal());
  handle(ipcMain, IPC_CHANNELS.clearGoal, async () => sessionHost.clearGoal());
  handle(ipcMain, IPC_CHANNELS.getGoal, async () => sessionHost.getGoal());
}
