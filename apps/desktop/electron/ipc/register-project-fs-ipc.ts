/**
 * Project 文件系统 IPC (主题 E #62 拆分, 2026-09-08).
 *
 * - listProjectDir: 列出 cwd 内子文件 / 子目录
 * - readProjectFile: 读 cwd 内文件 (受 cwd-sandbox 限制)
 * - revealInFolder: 在系统文件管理器打开
 *
 * cwd 由 SessionHost 提供 (打开项目后才有 cwd).
 */
import { shell, type IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import {
  listProjectDir,
  readProjectFile,
  revealProjectPath,
} from "../agent/project-fs";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

export function registerProjectFsIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  const cwdOf = () => sessionHost.getStatus().cwd;

  handle(ipcMain, IPC_CHANNELS.listProjectDir, async (_e, relPath?: string) =>
    listProjectDir(cwdOf() ?? "", relPath ?? ""),
  );
  handle(ipcMain, IPC_CHANNELS.readProjectFile, async (_e, relPath: string) =>
    readProjectFile(cwdOf() ?? "", relPath),
  );
  handle(ipcMain, IPC_CHANNELS.revealInFolder, async (_e, relPath: string) => {
    const result = revealProjectPath(cwdOf() ?? "", relPath);
    if (result.ok && result.path) {
      shell.showItemInFolder(result.path);
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });
}
