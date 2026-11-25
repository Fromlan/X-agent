/** Keep connection setup and available editor commands in sync with the active Godot project. */
import { useEffect, useRef, useState } from "react";
import { SelectMenu } from "../SelectMenu";
import { SettingsNotice } from "../SettingsNotice";
import type { ClientPrefs, GodotRpcCallDto, GodotRpcStatusDto } from "@shared/ipc";
import { GODOT_RPC_DEFAULT_WAIT_MS, godotRpcMethodTool } from "@shared/godot-rpc";
import { projectGodotClients } from "@shared/godot-connection";
import { godotConnectionLabel, godotConnectionWarning, isProjectGodotConnected, projectGodotConnection } from "../../lib/godot-connection";
import { GodotEngineSettings } from "./GodotEngineSettings";

export type GodotSettingsSection = "editor";

type Props = {
  open: boolean;
  prefs: ClientPrefs;
  cwd: string | null;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
  onOpenTools: () => void;
};

type Command = { label: string; call: GodotRpcCallDto };

const editorCommands: Command[] = [
  { label: "编辑器信息", call: { method: "get_editor_info" } },
  { label: "已打开场景", call: { method: "get_open_scenes" } },
  { label: "当前场景", call: { method: "get_edited_scene" } },
  { label: "运行场景", call: { method: "run_current_scene", wait_ms: GODOT_RPC_DEFAULT_WAIT_MS } },
  { label: "运行项目", call: { method: "play_main_scene", wait_ms: GODOT_RPC_DEFAULT_WAIT_MS } },
  { label: "运行错误", call: { method: "get_play_errors" } },
  { label: "停止运行", call: { method: "stop_scene" } },
  { label: "列出文件（前 50）", call: { method: "list_project_files", root: "res://", type: "", pattern: "", limit: 50 } },
  { label: "全局类名", call: { method: "list_global_classes" } },
  { label: "导出预设", call: { method: "list_export_presets" } },
  { label: "模板状态", call: { method: "check_export_templates" } },
];

/** Show project actions only when their prerequisites and tool permissions are met. */
export function GodotSettingsPage({ open, prefs, cwd, onPrefsChanged, onOpenTools }: Props) {
  const [rpc, setRpc] = useState<GodotRpcStatusDto | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [result, setResult] = useState<{ label: string; text: string; error?: boolean } | null>(null);
  const [scenePath, setScenePath] = useState("");
  const [scriptPath, setScriptPath] = useState("");
  const [importPaths, setImportPaths] = useState("");
  const [pending, setPending] = useState("");
  const prefsChangedRef = useRef(onPrefsChanged);
  prefsChangedRef.current = onPrefsChanged;

  useEffect(() => {
    if (!open) return;
    let active = true;
    let version = 0;
    /** Ignore stale snapshots if a fresher status event arrived during the IPC round trip. */
    const refresh = async () => {
      const current = ++version;
      try {
        const next = await window.xAgent.godot.status();
        if (active && current === version) setRpc(next);
      } catch (error) {
        if (active && current === version) setNotice({ text: String(error), error: true });
      }
    };
    const unsubscribe = window.xAgent.godot.onStatus((next) => { version++; setRpc(next); });
    void refresh();
    void window.xAgent.prefs.get().then((latest) => {
      if (active) prefsChangedRef.current?.(latest);
    }).catch((error: unknown) => { if (active) setNotice({ text: String(error), error: true }); });
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { active = false; unsubscribe(); window.clearInterval(timer); };
  }, [open, cwd]);

  const connected = isProjectGodotConnected(cwd, rpc);
  const connection = projectGodotConnection(cwd, rpc);
  // Connecting can also mean passive waiting after the editor has closed.
  const autoConnecting = !!connection && ["discovering", "preparing", "launching"].includes(connection.phase);
  const clients = projectGodotClients(cwd, rpc);
  const warning = godotConnectionWarning(rpc?.warning);
  const busy = pending !== "";

  /** Keep pending, cancellation and errors next to the selected connection action. */
  const perform = async (label: string, operation: () => Promise<void>) => {
    if (busy) return;
    setPending(label);
    setNotice(null);
    try { await operation(); }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), error: true }); }
    finally { setPending(""); }
  };

  /** Browse only when automatic detection needs help, or on an explicit request to change engine. */
  const pickEditor = (path?: string) => perform("选择引擎", async () => {
    const picked = await window.xAgent.godot.pickEditor(path);
    if (picked.canceled) return;
    if (!picked.ok) throw new Error(picked.error ?? "选择引擎失败");
    onPrefsChanged?.(await window.xAgent.prefs.get());
    setNotice({ text: "引擎已更新" });
  });

  /** Use the same permission mapping as the main process. */
  const available = (method: GodotRpcCallDto["method"]): boolean => {
    const tool = godotRpcMethodTool(method);
    return !tool || prefs.tools.includes(tool);
  };

  /** Return the editor's actual answer and keep failures in the same result area. */
  const runCommand = (label: string, call: GodotRpcCallDto) => perform(label, async () => {
    setResult(null);
    try {
      const reply = await window.xAgent.godot.request(call);
      if (!reply.ok) throw new Error(reply.error ?? "编辑器操作失败");
      const text = typeof reply.result === "string" ? reply.result : JSON.stringify(reply.result, null, 2);
      setResult({ label, text: text || "已完成" });
    } catch (error) {
      setResult({ label, text: error instanceof Error ? error.message : String(error), error: true });
    }
  });

  /** Keep repeated commands unavailable while the editor processes a request. */
  const commandButton = (label: string, call: GodotRpcCallDto, disabled = false) => (
    <button key={call.method} type="button" className="btn btn-ghost btn-sm" disabled={busy || disabled}
      onClick={() => void runCommand(label, call)}>{label}{pending === label && "…"}</button>
  );
  const commands = editorCommands.filter(({ call }) => available(call.method));
  const showScene = available("open_scene") || available("reload_scene");

  return <section className="settings-page">
    <div className="settings-page-head"><h3>Godot</h3></div>
    <div className="settings-block">
      <div className="settings-block-head">
        <h4 className="settings-block-title">项目连接</h4>
        <span className={`settings-status ${rpc?.error ? "is-error" : connected ? "is-ok" : "is-off"}`}>
          {!rpc ? "正在检测…" : rpc.error ? "连接异常" : !cwd ? "尚未打开项目" : godotConnectionLabel(cwd, rpc)}
        </span>
      </div>
      <label className="settings-row settings-row-check">
        <span className="settings-row-label">打开项目时自动连接 Godot</span>
        <input type="checkbox" checked={prefs.godotAutoConnect} disabled={busy} onChange={(event) => {
          const checked = event.target.checked;
          void perform("自动连接", async () => { onPrefsChanged?.(await window.xAgent.prefs.set({ godotAutoConnect: checked })); });
        }} />
      </label>
      {connection && !["idle", "connected"].includes(connection.phase) && connection.message !== godotConnectionLabel(cwd, rpc) &&
        <p className="modal-hint">{connection.message}</p>}
      {connection?.phase === "needs_engine" && <div className="settings-inline-row">
        {!!connection.candidates?.length && <SelectMenu variant="control" value="" aria-label="发现的 Godot 引擎" disabled={busy}
          options={[{ value: "", label: "选择检测到的引擎…" }, ...connection.candidates.map((engine) => ({ value: engine.path, label: `${engine.version} · ${engine.path}` }))]}
          onChange={(path) => { if (path) void pickEditor(path); }} />}
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void pickEditor()}>浏览引擎…</button>
      </div>}
      {cwd && rpc && !connected && !autoConnecting && connection?.phase !== "needs_engine" &&
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void perform("连接", async () => {
          const reply = await window.xAgent.godot.launchEditor();
          if (!reply.ok) throw new Error(reply.error ?? "连接失败");
          setRpc(await window.xAgent.godot.status());
        })}>{pending === "连接" ? "正在连接…" : "连接 Godot"}</button>}
      {(clients.length > 1 || clients.some((c) => c.id === rpc?.activeClientId)) &&
        <SelectMenu variant="control" aria-label="活动编辑器客户端" disabled={busy} value={rpc?.activeClientId ?? ""}
          options={[{ value: "", label: "自动选择编辑器" }, ...clients.map((c) => ({ value: c.id, label: `Godot ${c.godotVersion ?? ""} · ${c.id.slice(0, 8)}` }))]}
          onChange={(id) => void perform("选择编辑器", async () => {
            const reply = await window.xAgent.godot.setActiveClient(id || null);
            setRpc(reply.status);
            if (!reply.ok) throw new Error("该编辑器已不可用，请重新选择");
          })} />}
      {rpc && <details>
        <summary>连接维护</summary>
        <div className="settings-toolbar">
          {cwd && <button type="button" className="btn btn-ghost btn-sm" disabled={busy || autoConnecting}
            onClick={() => void perform("安装插件", async () => {
              const reply = await window.xAgent.godot.installAddon();
              if (!reply.ok) throw new Error(reply.error ?? "插件安装失败");
              setNotice({ text: "插件已安装" });
            })}>{pending === "安装插件" ? "正在安装…" : "安装/更新插件"}</button>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void perform("连接服务", async () => {
            if (rpc.running) {
              if (!(await window.xAgent.godot.stop()).ok) throw new Error("停止连接服务失败");
            } else {
              const status = await window.xAgent.godot.start();
              if (status.error) throw new Error(status.error);
            }
            setRpc(await window.xAgent.godot.status());
          })}>{pending === "连接服务" ? "正在处理…" : rpc.running ? "停止连接服务" : "启动连接服务"}</button>
          {connected && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void perform("测试连接", async () => {
            const reply = await window.xAgent.godot.ping();
            if (!reply.ok) throw new Error(reply.error ?? "连接测试失败");
            setNotice({ text: "Godot 连接正常" });
          })}>{pending === "测试连接" ? "正在测试…" : "测试连接"}</button>}
        </div>
      </details>}
      {warning && <p className="modal-hint">{warning}</p>}
      {rpc?.error && <p className="modal-hint settings-error">{rpc.error}</p>}
      {notice && <SettingsNotice text={notice.text} tone={notice.error ? "error" : "neutral"} onDismiss={() => setNotice(null)} />}
    </div>

    <GodotEngineSettings prefs={prefs} cwd={cwd} onPrefsChanged={onPrefsChanged} />

    {connected && <div className="settings-block">
      <div className="settings-block-head">
        <h4 className="settings-block-title">编辑器操作</h4>
        <button type="button" className="btn btn-ghost btn-sm settings-link-btn" onClick={onOpenTools}>管理工具</button>
      </div>
      {!!commands.length && <div className="settings-toolbar">{commands.map(({ label, call }) => commandButton(label, call))}</div>}
      {showScene && <div className="settings-inline-row">
        <input className="input" value={scenePath} aria-label="场景路径" placeholder="res://scenes/main.tscn"
          onChange={(e) => setScenePath(e.target.value)} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void perform("选择场景", async () => {
          const reply = await window.xAgent.godot.pickScene();
          if (reply.canceled) return;
          if (!reply.ok || !reply.path) throw new Error(reply.error ?? "选择场景失败");
          setScenePath(reply.path);
        })}>浏览场景…</button>
        {available("open_scene") && commandButton("打开场景", { method: "open_scene", path: scenePath.trim() }, !scenePath.trim())}
        {available("reload_scene") && commandButton("重载场景", { method: "reload_scene", path: scenePath.trim() }, !scenePath.trim())}
      </div>}
      {available("import_resources") && <div className="settings-inline-row">
        <input className="input" value={importPaths} aria-label="资源路径" placeholder="多个路径用逗号分隔"
          onChange={(e) => setImportPaths(e.target.value)} />
        {commandButton(importPaths.trim() ? "导入资源" : "扫描全部资源",
          { method: "import_resources", paths: importPaths.split(/[,，;\n]/).map((p) => p.trim()).filter(Boolean) })}
      </div>}
      {available("inspect_script") && <div className="settings-inline-row">
        <input className="input" value={scriptPath} aria-label="脚本路径" placeholder="res://player.gd"
          onChange={(e) => setScriptPath(e.target.value)} />
        {commandButton("查看脚本信息", { method: "inspect_script", path: scriptPath.trim() }, !scriptPath.trim())}
      </div>}
      {result && <SettingsNotice text={`${result.label}\n${result.text}`} pre
        tone={result.error ? "error" : "neutral"} onDismiss={() => setResult(null)} />}
    </div>}
  </section>;
}
