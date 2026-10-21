import { useCallback, useEffect, useState } from "react";
import { SelectMenu } from "../SelectMenu";
import { SettingsNotice } from "../SettingsNotice";
import {
  type ClientPrefs,
  type GodotRpcCallDto,
  type GodotRpcStatusDto,
} from "@shared/ipc";
import { GODOT_RPC_DEFAULT_WAIT_MS } from "@shared/godot-rpc";
import { godotConnectionLabel, godotConnectionWarning, isProjectGodotConnected, projectGodotConnection } from "../../lib/godot-connection";
import { normalizeProjectKey } from "@shared/project-path";

/** Kept for API compat; Godot settings is editor-only (no docs sub-section). */
export type GodotSettingsSection = "editor";

function rpcStatusLabel(cwd: string | null, rpc: GodotRpcStatusDto | null): {
  text: string;
  tone: "is-ok" | "is-warn" | "is-off" | "is-error";
} {
  if (rpc?.error) return { text: "错误", tone: "is-error" };
  if (!rpc?.running) return { text: "桥接未启动", tone: "is-off" };
  if (isProjectGodotConnected(cwd, rpc)) return { text: "已连接", tone: "is-ok" };
  return { text: godotConnectionLabel(cwd, rpc), tone: "is-warn" };
}

type Props = {
  open: boolean;
  prefs: ClientPrefs;
  cwd: string | null;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
};

export function GodotSettingsPage({
  open,
  prefs,
  cwd,
  onPrefsChanged,
}: Props) {
  const [rpc, setRpc] = useState<GodotRpcStatusDto | null>(null);
  const [rpcMsg, setRpcMsg] = useState<string | null>(null);
  const [scenePath, setScenePath] = useState("res://");
  const [importPaths, setImportPaths] = useState("res://");
  const [connecting, setConnecting] = useState(false);

  const refreshRpc = useCallback(async () => {
    setRpc(await window.xAgent.godot.status());
  }, []);

  useEffect(() => {
    if (!open) return;
    const unsubscribe = window.xAgent.godot.onStatus(setRpc);
    let cancelled = false;
    void (async () => {
      const status = await window.xAgent.godot.status();
      if (cancelled) return;
      setRpc(status);
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [open, cwd]);

  // 打开页面期间每 2s 轮询桥接状态：插件断开/重连（含桥接重启后的自动恢复）能实时反映。
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      void refreshRpc();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [open, refreshRpc]);

  useEffect(() => {
    if (!open) setRpcMsg(null);
  }, [open]);

  const runRpc = async (call: GodotRpcCallDto) => {
    const res = await window.xAgent.godot.request(call);
    if (!res.ok) {
      setRpcMsg(res.error ?? "RPC 调用失败");
    } else {
      setRpcMsg("ok");
    }
    await refreshRpc();
  };

  const rpcTone = rpcStatusLabel(cwd, rpc);
  const rpcWarning = godotConnectionWarning(rpc?.warning);
  const connection = projectGodotConnection(cwd, rpc);

  /** Remember a discovered or manually browsed engine, then let the main process resume connection. */
  const pickEditor = async (candidatePath?: string): Promise<void> => {
    try {
      const res = await window.xAgent.godot.pickEditor(candidatePath);
      if (res.canceled) return;
      if (!res.ok || !res.path) { setRpcMsg(res.error ?? "未选择引擎"); return; }
      onPrefsChanged?.(await window.xAgent.prefs.get());
      setRpcMsg("引擎已更新");
    } catch (error) { setRpcMsg(error instanceof Error ? error.message : String(error)); }
  };

  return (
    <section className="settings-page">
      <div className="settings-page-head">
        <h3>Godot</h3>
      </div>

      <div className="settings-block">
        <h4 className="settings-block-title">引擎</h4>
        <label className="settings-row settings-row-check">
          <span className="settings-row-label">打开项目时自动连接 Godot</span>
          <input type="checkbox" checked={prefs.godotAutoConnect} onChange={async (event) => {
            try {
              const next = await window.xAgent.prefs.set({ godotAutoConnect: event.target.checked });
              onPrefsChanged?.(next);
              await refreshRpc();
            } catch (error) { setRpcMsg(error instanceof Error ? error.message : String(error)); }
          }} />
        </label>
        <div className="settings-inline-row">
          <input
            type="text"
            className="input"
            readOnly
            value={connection?.enginePath ?? prefs.godotProjectEditors[normalizeProjectKey(cwd ?? "")] ?? prefs.godotEditorPath ?? ""}
            placeholder="自动查找 Godot；也可手动选择…"
            aria-label="Godot editor path"
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void pickEditor()}
          >
            浏览…
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={connecting}
            onClick={async () => {
              setConnecting(true);
              try {
                const res = await window.xAgent.godot.launchEditor();
                setRpcMsg(res.ok ? "Godot 已连接" : res.error ?? "连接失败");
                await refreshRpc();
              } catch (error) { setRpcMsg(error instanceof Error ? error.message : String(error)); }
              finally { setConnecting(false); }
            }}
          >
            {connecting ? "正在连接…" : "连接 Godot"}
          </button>
        </div>
        {connection?.phase === "needs_engine" && Boolean(connection.candidates?.length) && <SelectMenu
          variant="control" value="" aria-label="发现的 Godot 引擎"
          options={[{ value: "", label: "选择检测到的引擎…" }, ...connection.candidates!.map((engine) => ({ value: engine.path, label: `${engine.version} · ${engine.path}` }))]}
          onChange={(path) => { if (path) void pickEditor(path); }}
        />}
        {connection && !["idle", "connected"].includes(connection.phase) && <p className="modal-hint">{connection.message}</p>}
      </div>

      <div className="settings-block">
        <div className="settings-block-head">
          <h4 className="settings-block-title">编辑器连接</h4>
          <span
            className={`settings-status ${rpcTone.tone}`}
            title={rpc?.error ?? undefined}
          >
            {rpcTone.text}
          </span>
        </div>
        {(rpc?.clientInfos?.length ?? 0) > 0 && (
          <div className="field">
            <span>活动编辑器客户端</span>
            <SelectMenu
              variant="control"
              value={rpc?.activeClientId ?? ""}
              options={rpc!.clientInfos.map((c) => ({
                value: c.id,
                label: `${(c.projectPath || "unknown project").slice(-48)} · ${c.godotVersion ?? "?"}${c.addonVersion ? ` · addon v${c.addonVersion}` : ""} · ${c.id.slice(0, 8)}`,
              }))}
              onChange={(id) => {
                void (async () => {
                  const res = await window.xAgent.godot.setActiveClient(
                    id || null,
                  );
                  setRpc(res.status);
                  setRpcMsg(
                    id
                      ? "已切换编辑器"
                      : "已自动选择编辑器",
                  );
                })();
              }}
              aria-label="活动编辑器客户端"
            />
          </div>
        )}
        <div className="settings-toolbar">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              const res = await window.xAgent.godot.installAddon();
              setRpcMsg(
                res.ok
                  ? "插件已安装"
                  : res.error ?? "插件安装失败",
              );
              await refreshRpc();
            }}
          >
            安装/更新插件
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              const status = await window.xAgent.godot.start();
              setRpc(status);
              setRpcMsg(
                status.error ?? godotConnectionWarning(status.warning) ??
                  (status.running ? "连接服务已启动" : null),
              );
            }}
          >
            启动桥接
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await window.xAgent.godot.stop();
              await refreshRpc();
              setRpcMsg(null);
            }}
          >
            停止桥接
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const res = await window.xAgent.godot.request({
                method: "ping",
              });
              if (res.ok) {
                setRpcMsg("Godot 已连接");
              } else {
                setRpcMsg(
                  res.error === "no Godot editor connected"
                    ? "Godot 尚未连入桥接。请先安装插件并重启编辑器。"
                    : res.error ?? "ping failed",
                );
              }
              await refreshRpc();
            }}
          >
            Ping
          </button>
        </div>
        {rpcWarning && <p className="modal-hint">{rpcWarning}</p>}
        {rpc?.error && (
          <p className="modal-hint settings-error">{rpc.error}</p>
        )}
        <div className="settings-toolbar">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "get_editor_info" })}
          >
            编辑器信息
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "get_open_scenes" })}
          >
            已打开场景
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "get_edited_scene" })}
          >
            当前场景
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              runRpc({
                method: "run_current_scene",
                wait_ms: GODOT_RPC_DEFAULT_WAIT_MS,
              })
            }
          >
            运行场景
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              runRpc({
                method: "play_main_scene",
                wait_ms: GODOT_RPC_DEFAULT_WAIT_MS,
              })
            }
          >
            运行项目
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "get_play_errors" })}
          >
            运行错误
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "stop_scene" })}
          >
            停止运行
          </button>
        </div>
      </div>

      <div className="settings-block">
        <h4 className="settings-block-title">场景</h4>
        <div className="settings-inline-row">
          <input
            type="text"
            className="input"
            value={scenePath}
            onChange={(e) => setScenePath(e.target.value)}
            placeholder="res://scenes/main.tscn（需已连接）"
            aria-label="Scene path"
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const res = await window.xAgent.godot.pickScene();
              if (res.canceled) return;
              if (!res.ok || !res.path) {
                setRpcMsg(res.error ?? "未选择场景");
                return;
              }
              setScenePath(res.path);
              setRpcMsg(`已填入：${res.path}`);
            }}
          >
            浏览场景…
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              runRpc({ method: "open_scene", path: scenePath.trim() })
            }
          >
            打开场景
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              runRpc({ method: "reload_scene", path: scenePath.trim() })
            }
          >
            重载场景
          </button>
        </div>
      </div>

      <div className="settings-block">
        <h4 className="settings-block-title">资源导入</h4>
        <div className="settings-inline-row">
          <input
            type="text"
            className="input"
            value={importPaths}
            onChange={(e) => setImportPaths(e.target.value)}
            placeholder="空则全量扫描；多路径逗号分隔"
            aria-label="Import paths"
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const paths = importPaths
                .split(/[,;\n]/)
                .map((p) => p.trim())
                .filter(Boolean);
              void runRpc({
                method: "import_resources",
                paths,
              });
            }}
          >
            导入/扫描
          </button>
        </div>
      </div>

      <div className="settings-block">
        <h4 className="settings-block-title">项目信息</h4>
        <div className="settings-toolbar">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              runRpc({
                method: "list_project_files",
                root: "res://",
                type: "",
                pattern: "",
                limit: 50,
              })
            }
          >
            列出文件（前 50）
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "list_global_classes" })}
          >
            全局类名
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "list_export_presets" })}
          >
            导出预设
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "check_export_templates" })}
          >
            模板状态
          </button>
        </div>
        <div className="settings-inline-row">
          <input
            type="text"
            className="input"
            value={scenePath}
            onChange={(e) => setScenePath(e.target.value)}
            placeholder="res://player.gd（脚本路径）"
            aria-label="Inspect script path"
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!scenePath.trim()}
            onClick={() =>
              runRpc({ method: "inspect_script", path: scenePath.trim() })
            }
          >
            反射脚本
          </button>
        </div>
      </div>

      {rpcMsg && (
        <SettingsNotice
          text={rpcMsg}
          pre
          tone={/fail|error|失败|错误/i.test(rpcMsg) ? "error" : "neutral"}
          onDismiss={() => setRpcMsg(null)}
        />
      )}
    </section>
  );
}
