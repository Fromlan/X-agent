import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
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
import {
  clearUsageSummary,
  getUsageSummary,
} from "./agent/usage-store";
import type {
  ClientPrefs,
  PluginCreateInput,
} from "../shared/ipc";
import { ALL_TOGGLEABLE_TOOLS } from "../shared/ipc";
import { registerSessionIpc } from "./ipc/register-session-ipc";
import { registerProviderIpc } from "./ipc/register-provider-ipc";
import { registerGodotIpc } from "./ipc/register-godot-ipc";

let mainWindow: BrowserWindow | null = null;
const godotRpc = new GodotRpcBridge();
const sessionHost = new SessionHost(() => mainWindow, godotRpc);
const autoUpdate = new AppAutoUpdater(() => mainWindow);

function resolveAppIcon(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icon.ico"), join(process.resourcesPath, "icon.png")]
    : [
        join(__dirname, "../../build/icon.ico"),
        join(__dirname, "../../build/icon.png"),
      ];
  return candidates.find((p) => existsSync(p));
}

function createWindow(): void {
  const icon = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 560,
    title: "X-agent",
    backgroundColor: "#141414",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Markdown / target=_blank links: open in the OS browser, never a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalHttpUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? "";
    if (url === current) return;
    // Allow vite HMR / app reload on the renderer origin; send everything else out.
    if (
      process.env.ELECTRON_RENDERER_URL &&
      url.startsWith(process.env.ELECTRON_RENDERER_URL)
    ) {
      return;
    }
    if (url.startsWith("file:")) return;
    event.preventDefault();
    void openExternalHttpUrl(url);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function openExternalHttpUrl(
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "无效链接" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "仅支持 http/https 链接" };
  }
  try {
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function registerIpc(): void {
  ipcMain.handle("openProject", async (_e, path?: string) => {
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
    return sessionHost.openProject(projectPath, "continue");
  });

  registerSessionIpc(ipcMain, sessionHost);

  ipcMain.handle("getPrefs", async () => loadPrefs());
  ipcMain.handle("setPrefs", async (_e, patch: Partial<ClientPrefs>) => {
    if (patch.tools) {
      const allowed = new Set<string>(ALL_TOGGLEABLE_TOOLS as readonly string[]);
      const tools = patch.tools.filter((t) => allowed.has(t));
      await sessionHost.applyTools(tools);
      const { tools: _drop, ...rest } = patch;
      if (Object.keys(rest).length === 0) {
        return loadPrefs();
      }
      return patchPrefs(rest);
    }
    return patchPrefs(patch);
  });
  ipcMain.handle("checkBash", async () => checkBash());
  ipcMain.handle("applyBashShellPath", async (_e, shellPath?: string) =>
    applyBashShellPath(shellPath),
  );
  ipcMain.handle("pickBashShell", async () => {
    const current = checkBash();
    const result = await dialog.showOpenDialog({
      title: "选择 bash 可执行文件",
      defaultPath:
        current.shellPath ?? current.suggestedShellPath ?? undefined,
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
  ipcMain.handle("checkAuth", async () => checkAuth());
  ipcMain.handle("checkPiCli", async () => checkPiCli());
  ipcMain.handle("installPiCli", async () => installPiCli());
  ipcMain.handle("listProjectDir", async (_e, relPath?: string) => {
    const cwd = sessionHost.getStatus().cwd ?? "";
    return listProjectDir(cwd, relPath ?? "");
  });
  ipcMain.handle("readProjectFile", async (_e, relPath: string) => {
    const cwd = sessionHost.getStatus().cwd ?? "";
    return readProjectFile(cwd, relPath);
  });
  ipcMain.handle("revealInFolder", async (_e, relPath: string) => {
    const cwd = sessionHost.getStatus().cwd ?? "";
    return revealProjectPath(cwd, relPath);
  });

  registerGodotIpc(ipcMain, sessionHost, godotRpc);
  registerProviderIpc(ipcMain, sessionHost);

  ipcMain.handle("listPlugins", async (_e, cwd?: string | null) => {
    const effective = cwd ?? sessionHost.getStatus().cwd;
    return listPlugins(effective);
  });
  ipcMain.handle("listSessionSkills", async () => sessionHost.listSessionSkills());
  ipcMain.handle("readPlugin", async (_e, path: string) =>
    readPlugin(path, sessionHost.getStatus().cwd),
  );
  ipcMain.handle("writePlugin", async (_e, path: string, content: string) => {
    const result = writePlugin(path, content, sessionHost.getStatus().cwd);
    if (result.ok) {
      await sessionHost.reloadResources();
    }
    return result;
  });
  ipcMain.handle("createPlugin", async (_e, input: PluginCreateInput) => {
    const cwd = input.cwd ?? sessionHost.getStatus().cwd;
    const result = createPlugin({ ...input, cwd });
    if (result.ok) {
      await sessionHost.reloadResources();
    }
    return result;
  });
  ipcMain.handle("deletePlugin", async (_e, path: string) => {
    const result = deletePlugin(path, sessionHost.getStatus().cwd);
    if (result.ok) {
      await sessionHost.reloadResources();
    }
    return result;
  });
  ipcMain.handle("revealPlugin", async (_e, path: string) => {
    const result = revealPlugin(path, sessionHost.getStatus().cwd);
    if (result.ok && result.path) {
      shell.showItemInFolder(result.path);
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });

  ipcMain.handle("listInstalledPackages", async () => listInstalledPackages());
  ipcMain.handle("installPackage", async (_e, source: string) => {
    const result = await installPackage(source);
    if (result.ok) {
      await sessionHost.reloadResources();
    }
    return result;
  });
  ipcMain.handle("uninstallPackage", async (_e, source: string) => {
    const result = await uninstallPackage(source);
    if (result.ok) {
      await sessionHost.reloadResources();
    }
    return result;
  });
  ipcMain.handle("installGodotPiPackage", async () => {
    const result = await installGodotPiPackage();
    if (result.ok) {
      await sessionHost.reloadResources();
    }
    return result;
  });
  ipcMain.handle("openPiLogin", async () => openPiLogin());
  ipcMain.handle("openExternalUrl", async (_e, url: string) =>
    openExternalHttpUrl(typeof url === "string" ? url : ""),
  );
  ipcMain.handle("getUpdateStatus", async () => autoUpdate.getStatus());
  ipcMain.handle("checkForUpdates", async () => autoUpdate.check());
  ipcMain.handle("downloadUpdate", async () => autoUpdate.download());
  ipcMain.handle("installUpdate", async () => autoUpdate.quitAndInstall());
  ipcMain.handle("getUsageSummary", async (_e, options?: { days?: number }) =>
    getUsageSummary(options),
  );
  ipcMain.handle("clearUsageSummary", async () => clearUsageSummary());
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  autoUpdate.init();
  try {
    await godotRpc.start();
  } catch {
    // start() no longer throws; keep for safety
  }

  // Native skills package (godot-pi): install once when Pi CLI is available.
  try {
    const ensured = await ensureGodotPiPackageInstalled();
    if (ensured.attempted && ensured.installed) {
      await sessionHost.reloadResources();
    }
  } catch {
    // Manual install remains under Settings → Plugins
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  await godotRpc.stop();
  await sessionHost.dispose();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
