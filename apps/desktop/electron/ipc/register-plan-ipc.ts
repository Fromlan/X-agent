import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import type { AgentSessionMode } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";

/** Plan / goal / session-mode IPC — thin forwards to SessionHost. */
export function registerPlanIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  ipcMain.handle(IPC_CHANNELS.setSessionMode, async (_e, mode: AgentSessionMode) =>
    sessionHost.setSessionMode(mode),
  );
  ipcMain.handle(IPC_CHANNELS.getSessionMode, async () =>
    sessionHost.getSessionMode(),
  );
  ipcMain.handle(IPC_CHANNELS.buildPlan, async () => sessionHost.buildPlan());
  ipcMain.handle(IPC_CHANNELS.getPlanContent, async () =>
    sessionHost.getPlanContent(),
  );
  ipcMain.handle(IPC_CHANNELS.savePlanContent, async (_e, markdown: string) =>
    sessionHost.savePlanContent(markdown),
  );
  ipcMain.handle(IPC_CHANNELS.savePlanToWorkspace, async () =>
    sessionHost.savePlanToWorkspace(),
  );
  ipcMain.handle(IPC_CHANNELS.clearPlan, async () => sessionHost.clearPlan());
  ipcMain.handle(IPC_CHANNELS.setGoal, async (_e, condition: string) =>
    sessionHost.setGoal(condition),
  );
  ipcMain.handle(IPC_CHANNELS.pauseGoal, async () => sessionHost.pauseGoal());
  ipcMain.handle(IPC_CHANNELS.resumeGoal, async () => sessionHost.resumeGoal());
  ipcMain.handle(IPC_CHANNELS.clearGoal, async () => sessionHost.clearGoal());
  ipcMain.handle(IPC_CHANNELS.getGoal, async () => sessionHost.getGoal());
}
