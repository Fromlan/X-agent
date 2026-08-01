import { useCallback, useEffect, useState } from "react";
import { SelectMenu } from "../SelectMenu";
import { SettingsNotice, useAutoClearNotice } from "../SettingsNotice";
import {
  GODOT_DOCS_PRESET_BRANCHES,
  type ClientPrefs,
  type GodotDocsStatusDto,
  type GodotRpcCallDto,
  type GodotRpcStatusDto,
} from "@shared/ipc";
import { GODOT_RPC_DEFAULT_WAIT_MS } from "@shared/godot-rpc";

export type GodotSettingsSection = "editor" | "docs";

function branchLabel(b: string): string {
  if (b === "stable") return "stable（默认）";
  if (b === "master") return "master（latest）";
  return b;
}

function docsStatusLabel(status: GodotDocsStatusDto["status"] | undefined): {
  text: string;
  tone: "is-ok" | "is-warn" | "is-off";
} {
  if (status === "ready") return { text: "已导入", tone: "is-ok" };
  if (status === "downloading") return { text: "导入中", tone: "is-warn" };
  return { text: "未导入", tone: "is-off" };
}

function rpcStatusLabel(rpc: GodotRpcStatusDto | null): {
  text: string;
  tone: "is-ok" | "is-warn" | "is-off" | "is-error";
} {
  if (rpc?.error) return { text: "错误", tone: "is-error" };
  if (!rpc?.running) return { text: "桥接未启动", tone: "is-off" };
  if (rpc.clients > 0) {
    return { text: `已连接 · ${rpc.clients}`, tone: "is-ok" };
  }
  return { text: "等待连接", tone: "is-warn" };
}

type Props = {
  open: boolean;
  prefs: ClientPrefs;
  cwd: string | null;
  section: GodotSettingsSection;
  onSectionChange: (section: GodotSettingsSection) => void;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
};

export function GodotSettingsPage({
  open,
  prefs,
  cwd,
  section: godotSection,
  onSectionChange,
  onPrefsChanged,
}: Props) {
  const [rpc, setRpc] = useState<GodotRpcStatusDto | null>(null);
  const [rpcMsg, setRpcMsg] = useState<string | null>(null);
  const [docsStatus, setDocsStatus] = useState<GodotDocsStatusDto | null>(null);
  const [docsMsg, setDocsMsg] = useState<string | null>(null);
  const [docsBusy, setDocsBusy] = useState(false);
  const [docsBranches, setDocsBranches] = useState<string[]>([
    ...GODOT_DOCS_PRESET_BRANCHES,
  ]);
  const [docsCustomBranch, setDocsCustomBranch] = useState("");
  const [scenePath, setScenePath] = useState("res://");
  const [importPaths, setImportPaths] = useState("res://");

  const refreshRpc = useCallback(async () => {
    setRpc(await window.xAgent.godotRpcStatus());
  }, []);

  const refreshDocs = useCallback(async () => {
    const docs = await window.xAgent.godotDocsGetStatus();
    setDocsStatus(docs);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [status, docs, remote] = await Promise.all([
        window.xAgent.godotRpcStatus(),
        window.xAgent.godotDocsGetStatus(),
        window.xAgent.godotDocsListRemoteBranches(false),
      ]);
      if (cancelled) return;
      setRpc(status);
      setDocsStatus(docs);
      const branches =
        remote.ok && remote.branches.length > 0
          ? remote.branches
          : [...GODOT_DOCS_PRESET_BRANCHES];
      setDocsBranches(branches);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cwd]);

  useEffect(() => {
    if (!open) {
      setRpcMsg(null);
      setDocsMsg(null);
    }
  }, [open]);

  useAutoClearNotice(docsMsg, () => setDocsMsg(null));

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
  const docsTone = docsStatusLabel(docsStatus?.status);

  const setGodotSection = (section: GodotSettingsSection) => {
    onSectionChange(section);
    if (section === "editor") setDocsMsg(null);
    if (section === "docs") setRpcMsg(null);
  };

  return (
              <section className="settings-page">
                <div className="settings-page-head">
                  <h3>Godot</h3>
                </div>

                <div className="settings-subtabs" role="tablist" aria-label="Godot 设置分类">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={godotSection === "editor"}
                    className={
                      godotSection === "editor"
                        ? "settings-subtab active"
                        : "settings-subtab"
                    }
                    onClick={() => {
                      setGodotSection("editor");
                      setDocsMsg(null);
                    }}
                  >
                    编辑器连接
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={godotSection === "docs"}
                    className={
                      godotSection === "docs"
                        ? "settings-subtab active"
                        : "settings-subtab"
                    }
                    onClick={() => {
                      setGodotSection("docs");
                      setRpcMsg(null);
                    }}
                  >
                    官方文档
                  </button>
                </div>

                {godotSection === "editor" && (
                  <>
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
                        端口 {rpc?.port ?? 8765}。安装并启用 X-agent RPC 插件（非
                        godot_agent）。桥接写入 endpoint 含共享 token；插件握手校验后才接受调用。
                      </p>
                {(rpc?.clientInfos?.length ?? 0) > 0 && (
                  <div className="field">
                    <span>活动编辑器客户端</span>
                    <SelectMenu
                      variant="control"
                      value={rpc?.activeClientId ?? ""}
                      options={rpc!.clientInfos.map((c) => ({
                        value: c.id,
                        label: `${(c.projectPath || "unknown project").slice(-48)} · ${c.godotVersion ?? "?"} · ${c.id.slice(0, 8)}`,
                      }))}
                      onChange={(id) => {
                        void (async () => {
                          const res =
                            await window.xAgent.godotRpcSetActiveClient(
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
                            const res =
                              await window.xAgent.installGodotRpcAddon();
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
                          桥接已运行，等待客户端。请启用 X-agent RPC 后重启
                          Godot。
                        </p>
                      )}
                      {rpc?.warning && (
                        <p className="modal-hint">{rpc.warning}</p>
                      )}
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

                    {rpcMsg && (
                      <SettingsNotice
                        text={rpcMsg}
                        pre
                        tone={
                          /fail|error|失败|错误/i.test(rpcMsg)
                            ? "error"
                            : "neutral"
                        }
                        onDismiss={() => setRpcMsg(null)}
                      />
                    )}
                  </>
                )}

                {godotSection === "docs" && (
                  <>
                    <div className="settings-block">
                      <div className="settings-block-head">
                        <h4 className="settings-block-title">文档缓存</h4>
                        <span className={`settings-status ${docsTone.tone}`}>
                          {docsTone.text}
                        </span>
                      </div>
                      <p className="modal-hint">
                        导入含 .rst 的源码 zip（非 HTML 包）；导入后启用文档工具。
                      </p>
                <div className="field">
                  <span>文档版本分支</span>
                  <SelectMenu
                    variant="control"
                    value={
                      docsBranches.includes(prefs.godotDocsBranch)
                        ? prefs.godotDocsBranch
                        : "__custom__"
                    }
                    options={[
                      ...docsBranches.map((b) => ({
                        value: b,
                        label: branchLabel(b),
                      })),
                      { value: "__custom__", label: "自定义…" },
                    ]}
                    onChange={(v) => {
                      void (async () => {
                        if (v === "__custom__") {
                          const custom =
                            docsCustomBranch.trim() || prefs.godotDocsBranch;
                          const res =
                            await window.xAgent.godotDocsSetBranch(custom);
                          if (res.status) setDocsStatus(res.status);
                          if (res.ok) {
                            const next = await window.xAgent.getPrefs();
                            onPrefsChanged?.(next);
                            setDocsMsg(
                              `已选择自定义分支：${next.godotDocsBranch}`,
                            );
                          } else {
                            setDocsMsg(res.error ?? "切换失败");
                          }
                          return;
                        }
                        const res = await window.xAgent.godotDocsSetBranch(v);
                        if (res.status) setDocsStatus(res.status);
                        if (res.ok) {
                          const next = await window.xAgent.getPrefs();
                          onPrefsChanged?.(next);
                          setDocsMsg(`已选择文档版本：${v}`);
                        } else {
                          setDocsMsg(res.error ?? "切换失败");
                        }
                      })();
                    }}
                    aria-label="文档版本分支"
                  />
                </div>
                {!docsBranches.includes(prefs.godotDocsBranch) ||
                docsCustomBranch ? (
                  <div className="settings-inline-row">
                    <input
                      type="text"
                      className="input"
                      value={docsCustomBranch}
                      onChange={(e) => setDocsCustomBranch(e.target.value)}
                      placeholder="自定义分支名，如 4.3"
                      aria-label="Custom docs branch"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={docsBusy || !docsCustomBranch.trim()}
                      onClick={async () => {
                        const branch = docsCustomBranch.trim();
                        if (!branch) return;
                        setDocsBusy(true);
                        try {
                          const res =
                            await window.xAgent.godotDocsSetBranch(branch);
                          if (res.status) setDocsStatus(res.status);
                          if (res.ok) {
                            const next = await window.xAgent.getPrefs();
                            onPrefsChanged?.(next);
                            setDocsMsg(`已选择文档版本：${branch}`);
                          } else {
                            setDocsMsg(res.error ?? "切换失败");
                          }
                        } finally {
                          setDocsBusy(false);
                        }
                      }}
                    >
                      应用
                    </button>
                  </div>
                ) : null}
                <p className="modal-hint">
                  当前分支：{docsStatus?.branch ?? prefs.godotDocsBranch}
                  {docsBranches.length
                    ? ` · 可选 ${docsBranches.length} 个版本`
                    : ""}
                  {docsStatus?.localBranches?.length
                    ? ` · 本地已有：${docsStatus.localBranches.join(", ")}`
                    : ""}
                </p>
                {docsStatus?.downloadUrl && (
                  <p className="modal-hint" style={{ wordBreak: "break-all" }}>
                    下载地址：{docsStatus.downloadUrl}
                  </p>
                )}
                <div className="settings-toolbar">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={docsBusy}
                    onClick={async () => {
                      setDocsBusy(true);
                      try {
                        const res =
                          await window.xAgent.godotDocsOpenDownloadUrl();
                        setDocsMsg(
                          res.ok
                            ? `已在浏览器打开下载：${res.url ?? ""}`
                            : res.error ?? "无法打开链接",
                        );
                      } finally {
                        setDocsBusy(false);
                      }
                    }}
                  >
                    打开下载链接
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={docsBusy}
                    onClick={async () => {
                      setDocsBusy(true);
                      setDocsMsg("请选择已下载的 godot-docs 源码 zip…");
                      try {
                        const res = await window.xAgent.godotDocsImportZip();
                        if (res.canceled) {
                          setDocsMsg(null);
                          return;
                        }
                        if (res.status) setDocsStatus(res.status);
                        setDocsMsg(
                          res.ok
                            ? `已导入文档：${res.status?.branch ?? prefs.godotDocsBranch}`
                            : res.error ?? "导入失败",
                        );
                      } finally {
                        setDocsBusy(false);
                      }
                    }}
                  >
                    导入 zip…
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={docsBusy || docsStatus?.status !== "ready"}
                    onClick={async () => {
                      setDocsBusy(true);
                      try {
                        const res = await window.xAgent.godotDocsRemoveLocal();
                        if (res.status) setDocsStatus(res.status);
                        setDocsMsg(
                          res.ok
                            ? "已删除本地文档缓存"
                            : res.error ?? "删除失败",
                        );
                      } finally {
                        setDocsBusy(false);
                      }
                    }}
                  >
                    删除本地缓存
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={docsBusy}
                    onClick={async () => {
                      setDocsBusy(true);
                      try {
                        const remote =
                          await window.xAgent.godotDocsListRemoteBranches(true);
                        if (remote.status) setDocsStatus(remote.status);
                        if (remote.branches.length > 0) {
                          setDocsBranches(remote.branches);
                        }
                        setDocsMsg(
                          remote.ok
                            ? `已刷新远程分支（${remote.branches.length}）`
                            : remote.error ?? "刷新失败",
                        );
                      } finally {
                        setDocsBusy(false);
                      }
                    }}
                  >
                    刷新分支列表
                  </button>
                </div>
                    </div>
                    {docsMsg && (
                      <SettingsNotice
                        text={docsMsg}
                        tone={
                          /失败|错误|无法/.test(docsMsg) ? "error" : "neutral"
                        }
                        onDismiss={() => setDocsMsg(null)}
                      />
                    )}
                  </>
                )}
              </section>
  );
}
