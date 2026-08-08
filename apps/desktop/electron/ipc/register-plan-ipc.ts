import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import type { AgentSessionMode } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

/** Plan / goal / session-mode IPC — thin forwards to SessionHost. */

/** E2: 计划正文 / 目标条件长度上限。 */
const PLAN_CONTENT_MAX_LENGTH = 2_000_000;
const GOAL_CONDITION_MAX_LENGTH = 20_000;

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
  handle(
    ipcMain,
    IPC_CHANNELS.savePlanContent,
    async (_e, markdown: string) => {
      if (
        typeof markdown !== "string" ||
        markdown.length > PLAN_CONTENT_MAX_LENGTH
      ) {
        return {
          ok: false,
          error: `计划正文过长（上限 ${PLAN_CONTENT_MAX_LENGTH} 字符）`,
        };
      }
      return sessionHost.savePlanContent(markdown);
    },
  );
  handle(ipcMain, IPC_CHANNELS.savePlanToWorkspace, async () =>
    sessionHost.savePlanToWorkspace(),
  );
  handle(ipcMain, IPC_CHANNELS.clearPlan, async () => sessionHost.clearPlan());
  handle(
    ipcMain,
    IPC_CHANNELS.setGoal,
    async (_e, condition: string) => {
      if (
        typeof condition !== "string" ||
        condition.length > GOAL_CONDITION_MAX_LENGTH
      ) {
        return {
          ok: false,
          error: `目标条件过长（上限 ${GOAL_CONDITION_MAX_LENGTH} 字符）`,
        };
      }
      return sessionHost.setGoal(condition);
    },
  );
  handle(ipcMain, IPC_CHANNELS.pauseGoal, async () => sessionHost.pauseGoal());
  handle(ipcMain, IPC_CHANNELS.resumeGoal, async () => sessionHost.resumeGoal());
  handle(ipcMain, IPC_CHANNELS.clearGoal, async () => sessionHost.clearGoal());
  handle(ipcMain, IPC_CHANNELS.getGoal, async () => sessionHost.getGoal());
}
