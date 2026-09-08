/**
 * 环境诊断 IPC (主题 E #62 拆分, 2026-09-08).
 *
 * - checkAuth: Pi auth.json 状态
 * - checkGit: 系统是否装 git
 * - checkPiCli / installPiCli: Pi CLI 可用性 + 引导安装
 * - getSecretCodecStatus: safeStorage 加密能力探测
 */
import { type IpcMain } from "electron";
import { checkAuth } from "../agent/auth-check";
import { checkGit } from "../agent/git-exec";
import { checkPiCli, installPiCli } from "../agent/pi-cli";
import { getSecretCodecStatus } from "../agent/secret-codec";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

export function registerEnvIpc(ipcMain: IpcMain): void {
  handle(ipcMain, IPC_CHANNELS.checkAuth, async () => await checkAuth());
  handle(ipcMain, IPC_CHANNELS.checkGit, async () => checkGit());
  handle(ipcMain, IPC_CHANNELS.checkPiCli, async () => checkPiCli());
  handle(ipcMain, IPC_CHANNELS.installPiCli, async () => installPiCli());
  handle(ipcMain, IPC_CHANNELS.getSecretCodecStatus, async () =>
    getSecretCodecStatus(),
  );
}
