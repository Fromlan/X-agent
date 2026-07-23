import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { join, relative, isAbsolute, sep } from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { SessionHost } from "./agent/session-host";
import { applyBashShellPath, checkBash } from "./agent/bash-check";
import { checkAuth } from "./agent/auth-check";
import { loadPrefs, patchPrefs } from "./agent/prefs";
import { GodotRpcBridge } from "./agent/godot-rpc-bridge";
import { FleetRegistry } from "./agent/fleet-registry";
import { installGodotRpcAddon } from "./agent/godot-addon-install";
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
const host = new SessionHost(() => mainWindow, godotRpc);
const fleet = new FleetRegistry();

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
    return host.openProject(projectPath, "continue");
  });

  ipcMain.handle("prompt", async (_e, text: string) => host.prompt(text));
  ipcMain.handle("abort", async () => host.abort());
  ipcMain.handle("newSession", async () => host.newSession());
  ipcMain.handle("setModel", async (_e, provider: string, id: string) =>
    host.setModel(provider, id),
  );
  ipcMain.handle("setThinkingLevel", async (_e, level: ThinkingLevel) =>
    host.setThinkingLevel(level),
  );
  ipcMain.handle("listModels", async () => host.listModels());
  ipcMain.handle("listSessions", async () => host.listSessions());
  ipcMain.handle("resumeSession", async (_e, sessionPath: string) =>
    host.resumeSession(sessionPath),
  );
  ipcMain.handle("deleteSession", async (_e, sessionPath: string) =>
    host.deleteSession(sessionPath),
  );
  ipcMain.handle("renameSession", async (_e, sessionPath: string, name: string) =>
    host.renameSession(sessionPath, name),
  );
  ipcMain.handle("getPrefs", async () => loadPrefs());
  ipcMain.handle("setPrefs", async (_e, patch: Partial<ClientPrefs>) => {
    if (patch.tools) {
      const allowed = new Set<string>(ALL_TOGGLEABLE_TOOLS as readonly string[]);
      const tools = patch.tools.filter((t) => allowed.has(t));
      await host.applyTools(tools);
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
  ipcMain.handle("getStatus", async () => host.getStatus());

  ipcMain.handle("fleetList", async () => fleet.list());
  ipcMain.handle("fleetCreate", async (_e, label: string, role?: "primary" | "worker" | "reviewer") => {
    const status = host.getStatus();
    return fleet.create({
      label,
      role: role ?? "worker",
      cwd: status.cwd,
    });
  });
  ipcMain.handle("fleetSetActive", async (_e, id: string) => ({
    ok: fleet.setActive(id),
  }));

  ipcMain.handle("godotRpcStatus", async () => {
    const s = godotRpc.getStatus();
    return {
      running: s.running,
      port: s.port,
      clients: s.clients,
      lastEvent: s.lastEvent,
      error: s.error,
      warning: s.warning,
    };
  });
  ipcMain.handle("godotRpcStart", async () => {
    try {
      const s = await godotRpc.start();
      return {
        running: s.running,
        port: s.port,
        clients: s.clients,
        lastEvent: s.lastEvent,
        error: s.error,
        warning: s.warning,
      };
    } catch (err) {
      return {
        running: false,
        port: GODOT_RPC_DEFAULT_PORT,
        clients: 0,
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
  ipcMain.handle("godotRpcRequest", async (_e, call: GodotRpcCallDto) => {
    const req = { ...call, id: randomUUID() } as GodotRpcCall & { id: string };
    const res = await godotRpc.request(req, godotRpcTimeoutMs(call));
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, result: res.result };
  });

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
      host.getStatus().cwd || prefs.lastProjectPath || undefined;

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
    const project = host.getStatus().cwd || prefs.lastProjectPath;
    if (!project) {
      return { ok: false, error: "请先打开项目或设置 lastProjectPath" };
    }
    return installGodotRpcAddon(project);
  });

  ipcMain.handle("pickGodotScene", async () => {
    const prefs = loadPrefs();
    const project =
      host.getStatus().cwd || prefs.lastProjectPath || undefined;
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

  ipcMain.handle("listPlugins", async (_e, cwd?: string | null) => {
    const effective = cwd ?? host.getStatus().cwd;
    return listPlugins(effective);
  });
  ipcMain.handle("readPlugin", async (_e, path: string) =>
    readPlugin(path, host.getStatus().cwd),
  );
  ipcMain.handle("writePlugin", async (_e, path: string, content: string) => {
    const result = writePlugin(path, content, host.getStatus().cwd);
    if (result.ok) {
      await host.reloadResources();
    }
    return result;
  });
  ipcMain.handle("createPlugin", async (_e, input: PluginCreateInput) => {
    const cwd = input.cwd ?? host.getStatus().cwd;
    const result = createPlugin({ ...input, cwd });
    if (result.ok) {
      await host.reloadResources();
    }
    return result;
  });
  ipcMain.handle("deletePlugin", async (_e, path: string) => {
    const result = deletePlugin(path, host.getStatus().cwd);
    if (result.ok) {
      await host.reloadResources();
    }
    return result;
  });
  ipcMain.handle("revealPlugin", async (_e, path: string) => {
    const result = revealPlugin(path, host.getStatus().cwd);
    if (result.ok && result.path) {
      shell.showItemInFolder(result.path);
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });
  ipcMain.handle("reloadResources", async () => host.reloadResources());

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
    const applied = await host.applyActivatedProvider(
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
}

app.whenReady().then(async () => {
  registerIpc();
  createWindow();
  fleet.create({ id: "primary", label: "Primary", role: "primary" });
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
  await host.dispose();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
