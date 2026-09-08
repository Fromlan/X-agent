/**
 * Bash / shell 诊断 IPC (主题 E #62 拆分, 2026-09-08).
 *
 * - checkBash: 当前 shell 是否可执行 bash
 * - checkBashLiveness: 跑真实 probe
 * - applyBashShellPath: 把用户选定的 shell 写进 Pi settings
 * - pickBashShell: 弹原生文件选择器
 */
import { dialog, type IpcMain } from "electron";
import {
  applyBashShellPath,
  checkBash,
  findSuggestedBash,
} from "../agent/bash-check";
import { probeBashLiveness } from "../agent/bash-liveness";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

export function registerBashIpc(ipcMain: IpcMain): void {
  handle(ipcMain, IPC_CHANNELS.checkBash, async () => await checkBash());
  handle(ipcMain, IPC_CHANNELS.checkBashLiveness, async () =>
    await probeBashLiveness({ findSuggested: findSuggestedBash }),
  );
  handle(ipcMain, IPC_CHANNELS.applyBashShellPath, async (_e, shellPath?: string) =>
    await applyBashShellPath(shellPath),
  );
  handle(ipcMain, IPC_CHANNELS.pickBashShell, async () => {
    const current = await checkBash();
    const result = await dialog.showOpenDialog({
      title: "选择 bash 可执行文件",
      defaultPath: current.shellPath ?? current.suggestedShellPath ?? undefined,
      properties: ["openFile"],
      filters:
        process.platform === "win32"
          ? [
              { name: "bash", extensions: ["exe"] },
              { name: "所有文件", extensions: ["*"] },
            ]
          : [{ name: "bash", extensions: ["*"] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    return { ok: true, path: result.filePaths[0]! };
  });
}
