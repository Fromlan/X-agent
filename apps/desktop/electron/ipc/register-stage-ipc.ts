/**
 * Stage workflow IPC — thin forwards to SessionHost.getStageController().
 */
import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { isStageId } from "../../shared/stage";
import { handle } from "./register-ipc";

export function registerStageIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  handle(ipcMain, IPC_CHANNELS.getStage, async () => {
    const ctrl = sessionHost.getStageController();
    if (!ctrl) return null;
    return ctrl.getInfo();
  });

  handle(ipcMain, IPC_CHANNELS.setStage, async (_e, stage: unknown) => {
    const ctrl = sessionHost.getStageController();
    if (!ctrl) return { ok: false, error: "尚未打开项目" };
    if (!isStageId(stage)) {
      return { ok: false, error: `未知阶段：${String(stage)}` };
    }
    return ctrl.setStage(stage);
  });

  handle(
    ipcMain,
    IPC_CHANNELS.getGraduation,
    async (_e, stage: unknown) => {
      const ctrl = sessionHost.getStageController();
      if (!ctrl) {
        return {
          current: "design",
          next: null,
          checks: [],
          passed: 0,
          total: 0,
          allPassed: false,
          canSkip: true,
        };
      }
      if (stage && isStageId(stage)) {
        return ctrl.getGraduation(stage);
      }
      return ctrl.getGraduation();
    },
  );

  handle(
    ipcMain,
    IPC_CHANNELS.toggleManualCheck,
    async (_e, checkId: unknown, value: unknown) => {
      const ctrl = sessionHost.getStageController();
      if (!ctrl) return null;
      if (typeof checkId !== "string" || typeof value !== "boolean") {
        return null;
      }
      return ctrl.toggleManualCheck(checkId, value);
    },
  );
}
