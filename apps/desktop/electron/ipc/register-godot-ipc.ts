import { dialog, shell, type IpcMain } from "electron";
import { existsSync } from "node:fs";
import { relative, isAbsolute, sep } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { GodotRpcBridge } from "../agent/godot-rpc-bridge";
import type { SessionHost } from "../agent/session-host";
import { getCachedPrefs, patchPrefs } from "../agent/prefs";
import { installGodotRpcAddon } from "../agent/godot-addon-install";
import type { GodotRpcCallDto } from "../../shared/ipc";
import type { GodotRpcCall } from "../../shared/godot-rpc";
import {
  GODOT_RPC_DEFAULT_PORT,
  godotRpcTimeoutMs,
  isAllowedGodotRpcMethod,
} from "../../shared/godot-rpc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

/** Godot RPC bridge + editor launch IPC. */
export function registerGodotIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
  godotRpc: GodotRpcBridge,
): void {
  handle(ipcMain, IPC_CHANNELS.godotRpcStatus, async () => godotRpc.getStatus());
  handle(ipcMain, IPC_CHANNELS.godotRpcStart, async () => {
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
  handle(ipcMain, IPC_CHANNELS.godotRpcStop, async () => {
    await godotRpc.stop();
    return { ok: true };
  });
  handle(ipcMain, IPC_CHANNELS.godotRpcPing, async () => {
    const res = await godotRpc.request({ id: randomUUID(), method: "ping" });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, result: res.result };
  });
  handle(ipcMain, 
    IPC_CHANNELS.godotRpcRequest,
    async (
      _e,
      call: GodotRpcCallDto,
      options?: { clientId?: string | null },
    ) => {
      if (!call || !isAllowedGodotRpcMethod(call.method)) {
        return {
          ok: false,
          error: `不允许的 Godot RPC 方法：${String((call as { method?: unknown })?.method ?? "")}`,
        };
      }
      const req = { ...call, id: randomUUID() } as GodotRpcCall & { id: string };
      const res = await godotRpc.request(req, godotRpcTimeoutMs(call), options);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, result: res.result };
    },
  );
  handle(ipcMain, IPC_CHANNELS.godotRpcSetActiveClient, async (_e, clientId: string | null) => ({
    ok: godotRpc.setActiveClient(clientId),
    status: godotRpc.getStatus(),
  }));

  handle(ipcMain, IPC_CHANNELS.pickGodotEditor, async () => {
    const prefs = getCachedPrefs();
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
    await patchPrefs({ godotEditorPath: path });
    return { ok: true, path };
  });

  handle(ipcMain, IPC_CHANNELS.launchGodotEditor, async () => {
    const prefs = getCachedPrefs();
    const editor = prefs.godotEditorPath;
    if (!editor) {
      return { ok: false, error: "请先选择 Godot 引擎路径" };
    }
    if (!existsSync(editor)) {
      return { ok: false, error: `引擎不存在：${editor}` };
    }
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

  handle(ipcMain, IPC_CHANNELS.installGodotRpcAddon, async () => {
    const prefs = getCachedPrefs();
    const project = sessionHost.getStatus().cwd || prefs.lastProjectPath;
    if (!project) {
      return { ok: false, error: "请先打开项目或设置 lastProjectPath" };
    }
    return installGodotRpcAddon(project);
  });

  handle(ipcMain, IPC_CHANNELS.pickGodotScene, async () => {
    const prefs = getCachedPrefs();
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

}
