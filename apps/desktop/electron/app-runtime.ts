import { dialog, ipcMain, shell, type BrowserWindow } from "electron";
import { applyBashShellPath, checkBash } from "./agent/bash-check";
import { checkAuth } from "./agent/auth-check";
import { checkPiCli, installPiCli, openPiLogin } from "./agent/pi-cli";
import { loadPrefs, patchPrefs } from "./agent/prefs";
import { GodotRpcBridge } from "./agent/godot-rpc-bridge";
import { SessionHost } from "./agent/session-host";
import {
  listProjectDir,
  readProjectFile,
  revealProjectPath,
} from "./agent/project-fs";
import { AppAutoUpdater } from "./agent/auto-updater";
import {
  ensureGodotPiPackageInstalled,
  installGodotPiPackage,
  installPackage,
  listInstalledPackages,
  uninstallPackage,
} from "./agent/package-manager";
import {
  createPlugin,
  deletePlugin,
  listPlugins,
  readPlugin,
  revealPlugin,
  writePlugin,
} from "./agent/plugin-host";
import { clearUsageSummary, getUsageSummary } from "./agent/usage-store";
import type { ClientPrefs, PluginCreateInput } from "../shared/ipc";
import { ALL_TOGGLEABLE_TOOLS } from "../shared/ipc";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { registerSessionIpc } from "./ipc/register-session-ipc";
import { registerProviderIpc } from "./ipc/register-provider-ipc";
import { registerGodotIpc } from "./ipc/register-godot-ipc";

export type RuntimeHooks = {
  getMainWindow: () => BrowserWindow | null;
  revealMainWindow: () => void;
  openExternalHttpUrl: (
    url: string,
  ) => Promise<{ ok: boolean; error?: string }>;
};

let godotRpc: GodotRpcBridge | null = null;
let sessionHost: SessionHost | null = null;

function registerIpc(
  host: SessionHost,
  rpc: GodotRpcBridge,
  updater: AppAutoUpdater,
  hooks: RuntimeHooks,
): void {
  const cwdOf = () => host.getStatus().cwd;

  ipcMain.handle(IPC_CHANNELS.openProject, async (_e, path?: string) => {
    let projectPath = path;
    if (!projectPath) {
      const result = await dialog.showOpenDialog({
        title: "打开项目文件夹",
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return {
          ok: false,
          cwd: "",
          sessionId: "",
          model: null,
          thinkingLevel: "off",
          error: "已取消",
        };
      }
      projectPath = result.filePaths[0];
    }
    return host.openProject(projectPath, "continue");
  });

  registerSessionIpc(ipcMain, host);

  ipcMain.handle(IPC_CHANNELS.getPrefs, async () => loadPrefs());
  ipcMain.handle(IPC_CHANNELS.setPrefs, async (_e, patch: Partial<ClientPrefs>) => {
    if (patch.tools) {
      const allowed = new Set<string>(ALL_TOGGLEABLE_TOOLS as readonly string[]);
      await host.applyTools(patch.tools.filter((t) => allowed.has(t)));
      const { tools: _drop, ...rest } = patch;
      if (Object.keys(rest).length === 0) {
        return loadPrefs();
      }
      const next = patchPrefs(rest);
      if (rest.updateSource !== undefined) {
        updater.applyFeed(next.updateSource);
      }
      return next;
    }
    const next = patchPrefs(patch);
    if (patch.updateSource !== undefined) {
      updater.applyFeed(next.updateSource);
    }
    return next;
  });
  ipcMain.handle(IPC_CHANNELS.checkBash, async () => checkBash());
  ipcMain.handle(IPC_CHANNELS.applyBashShellPath, async (_e, shellPath?: string) =>
    applyBashShellPath(shellPath),
  );
  ipcMain.handle(IPC_CHANNELS.pickBashShell, async () => {
    const current = checkBash();
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
  ipcMain.handle(IPC_CHANNELS.checkAuth, async () => checkAuth());
  ipcMain.handle(IPC_CHANNELS.checkPiCli, async () => checkPiCli());
  ipcMain.handle(IPC_CHANNELS.installPiCli, async () => installPiCli());
  ipcMain.handle(IPC_CHANNELS.listProjectDir, async (_e, relPath?: string) =>
    listProjectDir(cwdOf() ?? "", relPath ?? ""),
  );
  ipcMain.handle(IPC_CHANNELS.readProjectFile, async (_e, relPath: string) =>
    readProjectFile(cwdOf() ?? "", relPath),
  );
  ipcMain.handle(IPC_CHANNELS.revealInFolder, async (_e, relPath: string) => {
    const result = revealProjectPath(cwdOf() ?? "", relPath);
    if (result.ok && result.path) {
      shell.showItemInFolder(result.path);
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });

  registerGodotIpc(ipcMain, host, rpc);
  registerProviderIpc(ipcMain, host);

  ipcMain.handle(IPC_CHANNELS.listPlugins, async (_e, cwd?: string | null) =>
    listPlugins(cwd ?? cwdOf()),
  );
  ipcMain.handle(IPC_CHANNELS.listSessionSkills, async () =>
    host.listSessionSkills(),
  );
  ipcMain.handle(IPC_CHANNELS.readPlugin, async (_e, path: string) =>
    readPlugin(path, cwdOf()),
  );
  ipcMain.handle(IPC_CHANNELS.writePlugin, async (_e, path: string, content: string) => {
    const result = writePlugin(path, content, cwdOf());
    if (result.ok) await host.reloadResources();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.createPlugin, async (_e, input: PluginCreateInput) => {
    const result = createPlugin({ ...input, cwd: input.cwd ?? cwdOf() });
    if (result.ok) await host.reloadResources();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.deletePlugin, async (_e, path: string) => {
    const result = deletePlugin(path, cwdOf());
    if (result.ok) await host.reloadResources();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.revealPlugin, async (_e, path: string) => {
    const result = revealPlugin(path, cwdOf());
    if (result.ok && result.path) shell.showItemInFolder(result.path);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });

  ipcMain.handle(IPC_CHANNELS.listInstalledPackages, async () =>
    listInstalledPackages(),
  );
  ipcMain.handle(IPC_CHANNELS.installPackage, async (_e, source: string) => {
    const result = await installPackage(source);
    if (result.ok) await host.reloadResources();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.uninstallPackage, async (_e, source: string) => {
    const result = await uninstallPackage(source);
    if (result.ok) await host.reloadResources();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.installGodotPiPackage, async () => {
    const result = await installGodotPiPackage();
    if (result.ok) await host.reloadResources();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.openPiLogin, async () => openPiLogin());
  ipcMain.handle(IPC_CHANNELS.openExternalUrl, async (_e, url: string) =>
    hooks.openExternalHttpUrl(typeof url === "string" ? url : ""),
  );
  ipcMain.handle(IPC_CHANNELS.getUpdateStatus, async () => updater.getStatus());
  ipcMain.handle(IPC_CHANNELS.checkForUpdates, async () => updater.check());
  ipcMain.handle(IPC_CHANNELS.downloadUpdate, async () => updater.download());
  ipcMain.handle(IPC_CHANNELS.installUpdate, async () => updater.quitAndInstall());
  ipcMain.handle(IPC_CHANNELS.getUsageSummary, async (_e, options?: { days?: number }) =>
    getUsageSummary(options),
  );
  ipcMain.handle(IPC_CHANNELS.clearUsageSummary, async () => clearUsageSummary());
  ipcMain.handle(IPC_CHANNELS.appReady, async () => {
    hooks.revealMainWindow();
    return { ok: true as const };
  });
}

/** Call only after splash is visible. */
export function bootRuntime(hooks: RuntimeHooks): void {
  godotRpc = new GodotRpcBridge();
  sessionHost = new SessionHost(hooks.getMainWindow, godotRpc);
  const updater = new AppAutoUpdater(hooks.getMainWindow);
  registerIpc(sessionHost, godotRpc, updater, hooks);
  updater.init();

  void (async () => {
    try {
      await godotRpc.start();
    } catch {
      /* ignore */
    }
    try {
      const ensured = await ensureGodotPiPackageInstalled();
      if (ensured.attempted && ensured.installed) {
        await sessionHost.reloadResources();
      }
    } catch {
      /* Manual install remains under Settings → Plugins */
    }
  })();
}

export async function shutdownRuntime(): Promise<void> {
  await godotRpc?.stop();
  await sessionHost?.dispose();
}
