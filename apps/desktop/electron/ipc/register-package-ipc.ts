/**
 * Package (Pi Package) IPC (主题 E #62 拆分, 2026-09-08).
 *
 * 安装 / 卸载 / 列出已安装 Package. install/uninstall 成功后
 * reload SessionHost.resources, 让 Pi DefaultResourceLoader 重新发现.
 */
import { type IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import {
  installGodotPiPackage,
  installPackage,
  listInstalledPackages,
  uninstallPackage,
} from "../agent/package-manager";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

export function registerPackageIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  handle(ipcMain, IPC_CHANNELS.listInstalledPackages, async () =>
    listInstalledPackages(),
  );
  handle(ipcMain, IPC_CHANNELS.installPackage, async (_e, source: string) => {
    const result = await installPackage(source);
    if (result.ok) await sessionHost.reloadResources();
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.uninstallPackage, async (_e, source: string) => {
    const result = await uninstallPackage(source);
    if (result.ok) await sessionHost.reloadResources();
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.installGodotPiPackage, async () => {
    const result = await installGodotPiPackage();
    if (result.ok) await sessionHost.reloadResources();
    return result;
  });
}
