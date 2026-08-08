import { useCallback, useEffect, useState } from "react";
import { SelectMenu } from "../SelectMenu";
import { SettingsNotice } from "../SettingsNotice";
import {
  type ClientPrefs,
  type GodotRpcCallDto,
  type GodotRpcStatusDto,
} from "@shared/ipc";
import { GODOT_RPC_DEFAULT_WAIT_MS } from "@shared/godot-rpc";

/** Kept for API compat; Godot settings is editor-only (no docs sub-section). */
export type GodotSettingsSection = "editor";

function rpcStatusLabel(rpc: GodotRpcStatusDto | null): {
  text: string;
  tone: "is-ok" | "is-warn" | "is-off" | "is-error";
} {
  if (rpc?.error) return { text: "错误", tone: "is-error" };
  if (!rpc?.running) return { text: "桥接未启动", tone: "is-off" };
  if ((rpc.authenticatedClients ?? 0) > 0) {
    return { text: `已连接 · ${rpc.authenticatedClients}`, tone: "is-ok" };
  }
  return { text: "等待连接", tone: "is-warn" };
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

  const refreshRpc = useCallback(async () => {
    setRpc(await window.xAgent.godotRpcStatus());
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const status = await window.xAgent.godotRpcStatus();
      if (cancelled) return;
      setRpc(status);
    })();
    return () => {
      cancelled = true;
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
    const res = await window.xAgent.godotRpcRequest(call);
    if (!res.ok) {
      setRpcMsg(res.error ?? "RPC 调用失败");
    } else {
      setRpcMsg("ok");
    }
    await refreshRpc();
  };

  const rpcTone = rpcStatusLabel(rpc);

  return (
    <section className="settings-page">
      <div className="settings-page-head">
        <h3>Godot</h3>
      </div>

      <div className="settings-block">
        <h4 className="settings-block-title">引擎</h4>
        <div className="settings-inline-row">
          <input
            type="text"
            className="input"
            readOnly
            value={prefs.godotEditorPath ?? ""}
            placeholder="尚未选择 Godot 可执行文件…"
            aria-label="Godot editor path"
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              const res = await window.xAgent.pickGodotEditor();
              if (res.canceled) return;
              if (!res.ok || !res.path) {
                setRpcMsg("未选择引擎");
                return;
              }
              const next = await window.xAgent.getPrefs();
              onPrefsChanged?.(next);
              setRpcMsg(`已选择引擎：${res.path}`);
            }}
          >
            浏览…
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const res = await window.xAgent.launchGodotEditor();
              setRpcMsg(
                res.ok
                  ? res.hint ?? "已启动 Godot 编辑器"
                  : res.error ?? "启动失败",
              );
              await refreshRpc();
            }}
          >
            启动编辑器
          </button>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-head">
          <h4 className="settings-block-title">RPC 桥接</h4>
          <span
            className={`settings-status ${rpcTone.tone}`}
            title={rpc?.error ?? undefined}
          >
            {rpcTone.text}
          </span>
        </div>
        <p className="modal-hint">
          端口 {rpc?.port ?? 8765}。X-agent 启动时会优先复用上次的 token 与端口，
          已运行的 Godot 插件通常无需重启即可连上。
          安装并启用 X-agent RPC 插件（非 godot_agent）。
          桥接写入 endpoint 含共享 token；插件握手校验后才接受调用。
          握手失败时点「安装/更新 RPC 插件」覆盖后再启动 Godot。
        </p>
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
                  const res = await window.xAgent.godotRpcSetActiveClient(
                    id || null,
                  );
                  setRpc(res.status);
                  setRpcMsg(
                    id
                      ? `已切换活动客户端：${id.slice(0, 8)}…`
                      : "已清除活动客户端（将使用首个连接）",
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
              const res = await window.xAgent.installGodotRpcAddon();
              setRpcMsg(
                res.ok
                  ? res.hint ?? "插件安装完成"
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
              const status = await window.xAgent.godotRpcStart();
              setRpc(status);
              setRpcMsg(
                status.error
                  ? status.error
                  : status.warning
                    ? status.warning
                    : status.running
                      ? `桥接已启动（端口 ${status.port}），等待 Godot 插件连入`
                      : null,
              );
            }}
          >
            启动桥接
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await window.xAgent.godotRpcStop();
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
              const res = await window.xAgent.godotRpcRequest({
                method: "ping",
              });
              if (res.ok) {
                setRpcMsg("ping ok — Godot 已连接");
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
        {rpc?.running && rpc.clients === 0 && (
          <p className="modal-hint">
            桥接已运行，等待客户端。请启用 X-agent RPC 后重启 Godot。
          </p>
        )}
        {rpc?.warning && <p className="modal-hint">{rpc.warning}</p>}
        {rpc?.error && (
          <p className="modal-hint settings-error">{rpc.error}</p>
        )}
        {rpc?.lastEvent && (
          <p className="modal-hint">
            最近事件：{JSON.stringify(rpc.lastEvent)}
          </p>
        )}
        <p className="modal-hint">调试</p>
        <div className="settings-toolbar">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "get_editor_info" })}
          >
            Info
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "get_open_scenes" })}
          >
            Open scenes
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "get_edited_scene" })}
          >
            Edited
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
            Run
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
            Run main
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "get_play_errors" })}
          >
            Errors
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => runRpc({ method: "stop_scene" })}
          >
            Stop
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
              const res = await window.xAgent.pickGodotScene();
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
        <h4 className="settings-block-title">项目内省（只读 1.3）</h4>
        <p className="modal-hint">
          这些 RPC 只读取编辑器状态，不修改文件 / 不启动子进程，适合手动验证扩展工具。
        </p>
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
