import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import type { GameStage } from "../../shared/game-stage";
import { isGameStage } from "../../shared/game-stage";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

/** Project game-stage workflow IPC — thin forwards to SessionHost. */
export function registerGameStageIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  handle(ipcMain, IPC_CHANNELS.getGameStage, async () =>
    sessionHost.getGameStageInfo(),
  );
  handle(ipcMain, IPC_CHANNELS.setGameStage, async (_e, stage: GameStage) => {
    if (!isGameStage(stage)) {
      return { ok: false, error: "未知的游戏阶段" };
    }
    return sessionHost.setGameStage(stage);
  });
}
