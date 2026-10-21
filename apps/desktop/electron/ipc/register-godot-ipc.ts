import { dialog, type IpcMain } from "electron";
import { relative, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { Value } from "typebox/value";
import type { GodotRpcBridge } from "../agent/godot-rpc-bridge";
import type { SessionHost } from "../agent/session-host";
import { getCachedPrefs, patchPrefs, rememberGodotEditor, registerGodotEngine, updateGodotEngine } from "../agent/prefs";
import type { GodotConnectionManager } from "../agent/godot-connection-manager";
import { probeGodotEngine } from "../agent/godot-engine-discovery";
import { normalizeProjectKey } from "../../shared/project-path";
import { requestGuardedGodotRpc } from "../agent/godot-rpc-request";
import type { GodotRpcCallDto } from "../../shared/ipc";
import type { GodotRpcCall } from "../../shared/godot-rpc";
import { GodotEngineMutationSchema, godotEngineName, type GodotEngineMutation } from "../../shared/godot-engines";
import {
  GODOT_RPC_DEFAULT_PORT,
  godotRpcMethodTool,
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

/** Only the native file dialog may introduce a new executable into the managed registry. */
async function browseGodotEditor() {
  return dialog.showOpenDialog({
    title: "选择 Godot 引擎可执行文件",
    defaultPath: getCachedPrefs().godotEditorPath ?? undefined,
    properties: ["openFile"],
    filters: [{ name: "Godot", extensions: process.platform === "win32" ? ["exe"] : ["*"] }],
  });
}

/** Godot RPC bridge + editor launch IPC. */
export function registerGodotIpc(
  ipcMain: IpcMain,
  sessionHost: SessionHost,
  godotRpc: GodotRpcBridge,
  connection: GodotConnectionManager,
): void {
  handle(ipcMain, IPC_CHANNELS.godotRpcStatus, async () => connection.getStatus());
  handle(ipcMain, IPC_CHANNELS.godotRpcStart, async () => {
    try {
      await godotRpc.start();
      void connection.connect();
      return connection.getStatus();
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
      await connection.stop();
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
      const res = await requestGuardedGodotRpc(godotRpc, call as GodotRpcCall, options);
      if (!res.ok) return { ok: false, error: res.error, routedTo: res.routedTo };
      return { ok: true, result: res.result, routedTo: res.routedTo };
    },
  );
  handle(ipcMain, IPC_CHANNELS.godotRpcSetActiveClient, async (_e, clientId: string | null) => ({
    ok: godotRpc.setActiveClient(clientId),
    status: connection.getStatus(),
  }));

  handle(ipcMain, IPC_CHANNELS.pickGodotEditor, async (_e, candidatePath?: unknown) => {
    const prefs = getCachedPrefs();
    const project = sessionHost.getStatus().cwd;
    let path: string;
    if (candidatePath !== undefined) {
      const candidates = [...(connection.getStatus().connection?.candidates ?? []), ...prefs.godotEngines];
      const candidate = candidates.find((item) => typeof candidatePath === "string" && normalizeProjectKey(item.path) === normalizeProjectKey(candidatePath));
      if (!candidate) return { ok: false, error: "所选引擎不在当前发现列表中，请重新检测或浏览选择" };
      path = candidate.path;
    } else {
      const result = await browseGodotEditor();
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }
      path = result.filePaths[0]!;
    }
    const engine = await probeGodotEngine(path);
    if (!engine) return { ok: false, error: "所选文件不是可用的 Godot 4 引擎" };
    if (normalizeProjectKey(project ?? "") !== normalizeProjectKey(sessionHost.getStatus().cwd ?? "")) return { ok: false, error: "项目已切换，请为当前项目重新选择引擎" };
    await registerGodotEngine({ ...engine, name: godotEngineName(engine.version) });
    if (project) await rememberGodotEditor(project, path);
    else await patchPrefs({ godotEditorPath: path });
    if (normalizeProjectKey(project ?? "") === normalizeProjectKey(sessionHost.getStatus().cwd ?? "")) connection.engineSelected(path);
    return { ok: true, path };
  });

  handle(ipcMain, IPC_CHANNELS.manageGodotEngine, async (_e, raw: unknown) => {
    if (!Value.Check(GodotEngineMutationSchema, raw)) return { ok: false, error: "引擎配置参数不合法" };
    const input = raw as GodotEngineMutation;
    try {
      if (input.action === "add") {
        const result = await browseGodotEditor();
        if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
        const engine = await probeGodotEngine(result.filePaths[0]!);
        if (!engine) return { ok: false, error: "所选文件不是可用的 Godot 4 引擎" };
        const prefs = await registerGodotEngine({ ...engine, name: godotEngineName(engine.version) });
        return { ok: true, prefs };
      }
      const project = sessionHost.getStatus().cwd;
      if (input.action === "project" && (!project || normalizeProjectKey(project) !== normalizeProjectKey(input.projectPath))) {
        return { ok: false, error: "项目已切换，请为当前项目重新选择引擎" };
      }
      if ((input.action === "default" || input.action === "project") && input.path !== null) {
        const engine = getCachedPrefs().godotEngines.find((entry) => normalizeProjectKey(entry.path) === normalizeProjectKey(input.path!));
        if (!engine) return { ok: false, error: "所选引擎不在已保存的配置中" };
        if (!await probeGodotEngine(engine.path)) return { ok: false, error: "所选 Godot 4 引擎不可用，请检查路径或重新添加" };
      }
      if (input.action === "project" && normalizeProjectKey(project ?? "") !== normalizeProjectKey(sessionHost.getStatus().cwd ?? "")) {
        return { ok: false, error: "项目已切换，请为当前项目重新选择引擎" };
      }
      const previousPrefs = getCachedPrefs();
      const prefs = await updateGodotEngine(input);
      const currentProject = sessionHost.getStatus().cwd;
      if (currentProject && (input.action === "remove" || input.action === "default")) {
        const projectKey = normalizeProjectKey(currentProject);
        const pinned = prefs.godotProjectEditors[projectKey];
        const status = connection.getStatus().connection;
        const selected = normalizeProjectKey(status?.projectPath ?? "") === normalizeProjectKey(currentProject)
          ? status?.enginePath
          : undefined;
        // Only invalidate configuration used by this project; unrelated registry edits must preserve its connection attempt.
        const affected = input.action === "default"
          ? !pinned && normalizeProjectKey(previousPrefs.godotEditorPath ?? "") !== normalizeProjectKey(prefs.godotEditorPath ?? "")
          : !pinned && (!selected || normalizeProjectKey(selected) === normalizeProjectKey(input.path));
        if (affected) connection.engineSettingsChanged();
      }
      if (input.action === "project" && normalizeProjectKey(project ?? "") === normalizeProjectKey(sessionHost.getStatus().cwd ?? "")) {
        connection.engineSelected(input.path ?? undefined);
      }
      return { ok: true, prefs };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  handle(ipcMain, IPC_CHANNELS.launchGodotEditor, async () => connection.connect());

  handle(ipcMain, IPC_CHANNELS.installGodotRpcAddon, async () => connection.prepareAddon());

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
