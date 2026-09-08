/**
 * Plugin (Prompt / Skill / Extension / Theme) IPC (主题 E #62 拆分, 2026-09-08).
 *
 * 写操作成功后 reload SessionHost.resources, 让 Pi DefaultResourceLoader
 * 重新发现 / 应用新的 skill / prompt / extension / theme.
 */
import { shell, type IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import {
  createPlugin,
  deletePlugin,
  listPlugins,
  readPlugin,
  revealPlugin,
  writePlugin,
} from "../agent/plugin-host";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";
import type { PluginCreateInput } from "../../shared/ipc";

export function registerPluginIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
): void {
  const cwdOf = () => sessionHost.getStatus().cwd;

  handle(ipcMain, IPC_CHANNELS.listPlugins, async (_e, cwd?: string | null) =>
    listPlugins(cwd ?? cwdOf()),
  );
  handle(ipcMain, IPC_CHANNELS.listSessionSlashItems, async () =>
    sessionHost.listSessionSlashItems(),
  );
  handle(ipcMain, IPC_CHANNELS.readPlugin, async (_e, path: string) =>
    readPlugin(path, cwdOf()),
  );
  handle(ipcMain, IPC_CHANNELS.writePlugin, async (_e, path: string, content: string) => {
    const result = writePlugin(path, content, cwdOf());
    if (result.ok) await sessionHost.reloadResources();
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.createPlugin, async (_e, input: PluginCreateInput) => {
    const result = createPlugin({ ...input, cwd: input.cwd ?? cwdOf() });
    if (result.ok) await sessionHost.reloadResources();
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.deletePlugin, async (_e, path: string) => {
    const result = deletePlugin(path, cwdOf());
    if (result.ok) await sessionHost.reloadResources();
    return result;
  });
  handle(ipcMain, IPC_CHANNELS.revealPlugin, async (_e, path: string) => {
    const result = revealPlugin(path, cwdOf());
    if (result.ok && result.path) shell.showItemInFolder(result.path);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });
}
