import { dialog, shell, type IpcMain } from "electron";
import { existsSync, statSync } from "node:fs";
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
  godotRpcMethodTool,
  godotRpcTimeoutMs,
  isAllowedGodotRpcMethod,
} from "../../shared/godot-rpc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

/** Basic param hygiene for renderer-provided RPC calls (length / shape caps). */
function validateGodotRpcCallParams(call: GodotRpcCallDto): string | null {
  for (const [key, value] of Object.entries(call)) {
    if (key === "method" || value == null) continue;
    if (typeof value === "string") {
      if (value.length > 4096) return `参数 ${key} 过长（>4096）`;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 512) return `参数 ${key} 条目过多（>512）`;
      if (
        value.some(
          (x) => typeof x === "string" && x.length > 4096,
        )
      ) {
        return `参数 ${key} 含超长字符串`;
      }
    }
  }
  return null;
}

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
    try {
      await godotRpc.stop();
      return { ok: true };
    } catch (err) {
      // E3: stop 异常（如 socket 关闭竞态）不应让 IPC reject 挂起 UI。
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `停止桥接失败：${message}` };
    }
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
      // 工具开关硬闸：GODOT_TOOLS 默认关闭，未勾选对应工具时拒绝调用
      // （否则「设置 → 工具」开关退化为纯 UI 偏好）。
      const gateTool = godotRpcMethodTool(call.method);
      if (gateTool && !getCachedPrefs().tools.includes(gateTool)) {
        return {
          ok: false,
          error: `未启用 Godot 工具 ${gateTool}，请先在 设置 → 工具 中勾选`,
        };
      }
      const paramError = validateGodotRpcCallParams(call);
      if (paramError) {
        return { ok: false, error: `Godot RPC 参数不合法：${paramError}` };
      }
      const req = { ...call, id: randomUUID() } as GodotRpcCall & { id: string };
      const res = await godotRpc.request(req, godotRpcTimeoutMs(call), options);
      if (!res.ok) return { ok: false, error: res.error, routedTo: res.routedTo };
      return { ok: true, result: res.result, routedTo: res.routedTo };
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
      // 二次确认：路径必须真实存在且为目录（prefs 侧已校验，防御纵深）。
      if (!existsSync(project) || !statSync(project).isDirectory()) {
        return { ok: false, error: `项目路径无效或不存在：${project}` };
      }
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
      // C9: spawn 的 error 是异步事件（ENOENT 之外 EACCES / 损坏 exe 等），
      // 同步 try/catch 抓不到。等 'spawn' 事件确认启动成功，失败时返回错误。
      const child = await new Promise<ReturnType<typeof spawn>>(
        (resolvePromise, rejectPromise) => {
          const child = spawn(editor, args, {
            detached: true,
            stdio: "ignore",
            windowsHide: false,
          });
          child.once("error", (err) => {
            rejectPromise(err);
          });
          child.once("spawn", () => resolvePromise(child));
        },
      );
      child.unref();
      return {
        ok: true,
        port: bridgeStatus.port,
        hint: project
          ? `已安装并启用 X-agent RPC 插件并用项目启动。需要在 Godot 中重启/确认插件启用后再 Ping（桥接端口 ${bridgeStatus.port}）。`
          : `已启动编辑器。请打开含 X-agent RPC 插件的项目（桥接端口 ${bridgeStatus.port}）。`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `无法启动 Godot 编辑器：${message}`,
      };
    }
  });

  handle(ipcMain, IPC_CHANNELS.installGodotRpcAddon, async () => {
    const prefs = getCachedPrefs();
    const project = sessionHost.getStatus().cwd || prefs.lastProjectPath;
    if (!project) {
      return { ok: false, error: "请先打开项目或设置 lastProjectPath" };
    }
    if (!existsSync(project) || !statSync(project).isDirectory()) {
      return { ok: false, error: `项目路径无效或不存在：${project}` };
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
