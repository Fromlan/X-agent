import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { join, relative, isAbsolute, sep } from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { installGodotRpcAddon } from "./agent/godot-addon-install";
import {
  getDocsDownloadZipUrl,
  getDocsStatus,
  importDocsZip,
  listRemoteDocsBranches,
  normalizeGodotDocsBranch,
  removeDocsBranch,
} from "./agent/godot-docs-cache";
import { AppAutoUpdater } from "./agent/auto-updater";
import {
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
  activateProviderProfile,
  deleteProviderProfile,
  getProviderProfile,
  importExistingProviderProfiles,
  listProviderPresets,
  listProviderProfiles,
  upsertProviderProfile,
} from "./agent/provider-store";
import { fetchProviderModels } from "./agent/model-fetch";
import type {
  ClientPrefs,
  GodotRpcCallDto,
  PluginCreateInput,
  ProviderUpsertInput,
  ThinkingLevel,
} from "../shared/ipc";
import { ALL_TOGGLEABLE_TOOLS } from "../shared/ipc";
import type { GodotRpcCall } from "../shared/godot-rpc";
import { GODOT_RPC_DEFAULT_PORT, godotRpcTimeoutMs } from "../shared/godot-rpc";

let mainWindow: BrowserWindow | null = null;
const godotRpc = new GodotRpcBridge();
const sessionHost = new SessionHost(() => mainWindow, godotRpc);
const autoUpdate = new AppAutoUpdater(() => mainWindow);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "X-agent",
    backgroundColor: "#1e1e24",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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

  ipcMain.handle("prompt", async (_e, text: string) => sessionHost.prompt(text));
  ipcMain.handle("abort", async () => sessionHost.abort());
  ipcMain.handle("previewRetract", async (_e, entryId: string) =>
    sessionHost.previewRetract(entryId),
  );
  ipcMain.handle(
    "retractToUserMessage",
    async (_e, entryId: string, options?: { undoFiles?: boolean }) =>
      sessionHost.retractToUserMessage(entryId, options),
  );
  ipcMain.handle(
    "editAndResend",
    async (
      _e,
      entryId: string,
      text: string,
      options?: { undoFiles?: boolean },
    ) => sessionHost.editAndResend(entryId, text, options),
  );
  ipcMain.handle(
    "regenerateFromUser",
    async (_e, entryId: string, options?: { undoFiles?: boolean }) =>
      sessionHost.regenerateFromUser(entryId, options),
  );
  ipcMain.handle("newSession", async () => sessionHost.newSession());
  ipcMain.handle("setModel", async (_e, provider: string, id: string) =>
    sessionHost.setModel(provider, id),
  );
  ipcMain.handle("setThinkingLevel", async (_e, level: ThinkingLevel) =>
    sessionHost.setThinkingLevel(level),
  );
  ipcMain.handle("listModels", async () => sessionHost.listModels());
  ipcMain.handle("listSessions", async () => sessionHost.listSessions());
  ipcMain.handle("resumeSession", async (_e, sessionPath: string) =>
    sessionHost.resumeSession(sessionPath),
  );
  ipcMain.handle("deleteSession", async (_e, sessionPath: string) =>
    sessionHost.deleteSession(sessionPath),
  );
  ipcMain.handle("closeWorkspace", async () => sessionHost.closeWorkspace());
  ipcMain.handle("renameSession", async (_e, sessionPath: string, name: string) =>
    sessionHost.renameSession(sessionPath, name),
  );
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
  ipcMain.handle("getStatus", async () => sessionHost.getStatus());
  ipcMain.handle("getToolDetail", async (_e, toolCallId: string) =>
    sessionHost.getToolDetail(toolCallId),
  );
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

  ipcMain.handle("godotRpcStatus", async () => godotRpc.getStatus());
  ipcMain.handle("godotRpcStart", async () => {
    try {
      return await godotRpc.start();
    } catch (err) {
      return {
        running: false,
        port: GODOT_RPC_DEFAULT_PORT,
        clients: 0,
        clientInfos: [],
        activeClientId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
  ipcMain.handle("godotRpcStop", async () => {
    await godotRpc.stop();
    return { ok: true };
  });
  ipcMain.handle("godotRpcPing", async () => {
    const res = await godotRpc.request({ id: randomUUID(), method: "ping" });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, result: res.result };
  });
  ipcMain.handle(
    "godotRpcRequest",
    async (
      _e,
      call: GodotRpcCallDto,
      options?: { clientId?: string | null },
    ) => {
      const req = { ...call, id: randomUUID() } as GodotRpcCall & { id: string };
      const res = await godotRpc.request(req, godotRpcTimeoutMs(call), options);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, result: res.result };
    },
  );
  ipcMain.handle("godotRpcSetActiveClient", async (_e, clientId: string | null) => ({
    ok: godotRpc.setActiveClient(clientId),
    status: godotRpc.getStatus(),
  }));

  ipcMain.handle("pickGodotEditor", async () => {
    const prefs = loadPrefs();
    const result = await dialog.showOpenDialog({
      title: "选择 Godot 引擎可执行文件",
      defaultPath: prefs.godotEditorPath ?? undefined,
      properties: ["openFile"],
      filters:
        process.platform === "win32"
          ? [
              { name: "Godot", extensions: ["exe"] },
              { name: "所有文件", extensions: ["*"] },
            ]
          : [
              { name: "Godot", extensions: ["*"] },
              { name: "应用程序", extensions: ["app"] },
            ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    const path = result.filePaths[0]!;
    patchPrefs({ godotEditorPath: path });
    return { ok: true, path };
  });

  ipcMain.handle("launchGodotEditor", async () => {
    const prefs = loadPrefs();
    const editor = prefs.godotEditorPath;
    if (!editor) {
      return { ok: false, error: "请先选择 Godot 引擎路径" };
    }
    if (!existsSync(editor)) {
      return { ok: false, error: `引擎不存在：${editor}` };
    }
    // Ensure bridge is up and endpoint file is written before Godot starts.
    const bridgeStatus = await godotRpc.start();
    if (!bridgeStatus.running) {
      return {
        ok: false,
        error: bridgeStatus.error ?? "无法启动 RPC 桥接",
      };
    }
    const project =
      sessionHost.getStatus().cwd || prefs.lastProjectPath || undefined;

    if (project) {
      const install = installGodotRpcAddon(project);
      if (!install.ok) {
        return { ok: false, error: install.error ?? "插件安装失败" };
      }
    }
    const args: string[] = [];
    if (project) {
      args.push("--path", project, "--editor");
    } else {
      args.push("--editor");
    }
    try {
      const child = spawn(editor, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      return {
        ok: true,
        port: bridgeStatus.port,
        hint: project
          ? `已安装并启用 X-agent RPC 插件并用项目启动。需要在 Godot 中重启/确认插件启用后再 Ping（桥接端口 ${bridgeStatus.port}）。`
          : `已启动编辑器。请打开含 X-agent RPC 插件的项目（桥接端口 ${bridgeStatus.port}）。`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("installGodotRpcAddon", async () => {
    const prefs = loadPrefs();
    const project = sessionHost.getStatus().cwd || prefs.lastProjectPath;
    if (!project) {
      return { ok: false, error: "请先打开项目或设置 lastProjectPath" };
    }
    return installGodotRpcAddon(project);
  });

  ipcMain.handle("pickGodotScene", async () => {
    const prefs = loadPrefs();
    const project =
      sessionHost.getStatus().cwd || prefs.lastProjectPath || undefined;
    const result = await dialog.showOpenDialog({
      title: "选择场景文件",
      defaultPath: project ?? undefined,
      properties: ["openFile"],
      filters: [
        { name: "Godot Scene", extensions: ["tscn", "scn"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    const abs = result.filePaths[0]!;
    if (project) {
      const rel = relative(project, abs);
      if (!isAbsolute(rel) && !rel.startsWith("..")) {
        const resPath = `res://${rel.split(sep).join("/")}`;
        return { ok: true, path: resPath };
      }
      return {
        ok: false,
        error: "场景不在当前项目目录内，无法转换为 res:// 路径",
      };
    }
    return { ok: true, path: abs };
  });

  ipcMain.handle("godotDocsGetStatus", async () => {
    const prefs = loadPrefs();
    return getDocsStatus(prefs.godotDocsBranch);
  });
  ipcMain.handle(
    "godotDocsListRemoteBranches",
    async (_e, force?: boolean) => {
      const listed = await listRemoteDocsBranches({ force: Boolean(force) });
      const prefs = loadPrefs();
      return {
        ...listed,
        status: getDocsStatus(prefs.godotDocsBranch),
      };
    },
  );
  ipcMain.handle("godotDocsSetBranch", async (_e, branch: string) => {
    const next = normalizeGodotDocsBranch(branch);
    patchPrefs({ godotDocsBranch: next });
    return { ok: true, status: getDocsStatus(next) };
  });
  ipcMain.handle("godotDocsOpenDownloadUrl", async (_e, branch?: string) => {
    const prefs = loadPrefs();
    const target = normalizeGodotDocsBranch(branch ?? prefs.godotDocsBranch);
    const url = getDocsDownloadZipUrl(target);
    try {
      await shell.openExternal(url);
      return { ok: true, url };
    } catch (err) {
      return {
        ok: false,
        url,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
  ipcMain.handle("godotDocsImportZip", async (_e, branch?: string) => {
    const prefs = loadPrefs();
    const target = normalizeGodotDocsBranch(branch ?? prefs.godotDocsBranch);
    if (target !== prefs.godotDocsBranch) {
      patchPrefs({ godotDocsBranch: target });
    }
    const picked = await dialog.showOpenDialog({
      title: `导入 Godot 文档 zip（分支 ${target}）`,
      properties: ["openFile"],
      filters: [
        { name: "ZIP", extensions: ["zip"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, canceled: true, status: getDocsStatus(target) };
    }
    const result = await importDocsZip(picked.filePaths[0]!, target);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? "导入失败",
        status: getDocsStatus(target),
      };
    }
    return { ok: true, status: getDocsStatus(target) };
  });
  ipcMain.handle("godotDocsRemoveLocal", async (_e, branch?: string) => {
    const prefs = loadPrefs();
    const target = normalizeGodotDocsBranch(branch ?? prefs.godotDocsBranch);
    const result = removeDocsBranch(target);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        status: getDocsStatus(target),
      };
    }
    return { ok: true, status: getDocsStatus(target) };
  });

  ipcMain.handle("listPlugins", async (_e, cwd?: string | null) => {
    const effective = cwd ?? sessionHost.getStatus().cwd;
    return listPlugins(effective);
  });
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
  ipcMain.handle("reloadResources", async () => sessionHost.reloadResources());

  ipcMain.handle("listProviderProfiles", async () => listProviderProfiles());
  ipcMain.handle("getProviderProfile", async (_e, id: string) =>
    getProviderProfile(id),
  );
  ipcMain.handle("upsertProviderProfile", async (_e, input: ProviderUpsertInput) =>
    upsertProviderProfile(input),
  );
  ipcMain.handle("deleteProviderProfile", async (_e, id: string) =>
    deleteProviderProfile(id),
  );
  ipcMain.handle("activateProviderProfile", async (_e, id: string) => {
    const result = activateProviderProfile(id);
    if (!result.ok || !result.provider || !result.model) return result;
    const applied = await sessionHost.applyActivatedProvider(
      result.provider,
      result.model,
    );
    if (!applied.ok) {
      return { ok: false, error: applied.error ?? "运行时重载失败" };
    }
    return result;
  });
  ipcMain.handle("listProviderPresets", async () => listProviderPresets());
  ipcMain.handle("importExistingProviderProfiles", async () =>
    importExistingProviderProfiles(),
  );
  ipcMain.handle(
    "fetchProviderModels",
    async (_e, input: { baseUrl: string; apiKey: string }) =>
      fetchProviderModels(input),
  );

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
  ipcMain.handle("getUpdateStatus", async () => autoUpdate.getStatus());
  ipcMain.handle("checkForUpdates", async () => autoUpdate.check());
  ipcMain.handle("downloadUpdate", async () => autoUpdate.download());
  ipcMain.handle("installUpdate", async () => autoUpdate.quitAndInstall());
}

app.whenReady().then(async () => {
  registerIpc();
  createWindow();
  autoUpdate.init();
  try {
    await godotRpc.start();
  } catch {
    // start() no longer throws; keep for safety
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
