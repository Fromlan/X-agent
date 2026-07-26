import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  Import,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  AVAILABLE_TOOLS,
  GODOT_TOOLS,
  type AppUpdateStatus,
  type BashCheckResult,
  type ClientPrefs,
  type FetchedProviderModel,
  type GodotRpcCallDto,
  type GodotRpcStatusDto,
  type ProviderApiKind,
  type ProviderModelEntry,
  type ProviderPreset,
  type ProviderProfileSummary,
  type ProviderUpsertInput,
  type ThinkingLevel,
} from "@shared/ipc";
import { GODOT_RPC_DEFAULT_WAIT_MS } from "@shared/godot-rpc";
import { PluginsPage } from "./PluginsPage";

type SettingsTab = "general" | "providers" | "tools" | "plugins" | "godot";

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

interface Props {
  open: boolean;
  prefs: ClientPrefs;
  cwd: string | null;
  onClose: () => void;
  onToggleTool: (tool: string) => void;
  onProvidersChanged?: () => void;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
  onBashChanged?: (bash: BashCheckResult) => void;
  /** When set, switch to this tab when the panel opens */
  initialTab?: SettingsTab;
}

const API_OPTIONS: { value: ProviderApiKind; label: string }[] = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
];

const emptyForm = (): ProviderUpsertInput => ({
  name: "",
  providerId: "",
  api: "openai-completions",
  baseUrl: "",
  apiKey: "",
  models: [{ id: "", name: "" }],
  notes: "",
});

export function SettingsPanel({
  open,
  prefs,
  cwd,
  onClose,
  onToggleTool,
  onProvidersChanged,
  onPrefsChanged,
  onBashChanged,
  initialTab,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? "providers");
  const [rpc, setRpc] = useState<GodotRpcStatusDto | null>(null);
  const [rpcMsg, setRpcMsg] = useState<string | null>(null);
  const [scenePath, setScenePath] = useState("res://");
  const [importPaths, setImportPaths] = useState("res://");
  const [profiles, setProfiles] = useState<ProviderProfileSummary[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProviderUpsertInput>(emptyForm());
  const [showPresetPicker, setShowPresetPicker] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState<FetchedProviderModel[]>([]);
  const [selectedFetchIds, setSelectedFetchIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showFetchPanel, setShowFetchPanel] = useState(false);
  const [bash, setBash] = useState<BashCheckResult | null>(null);
  const [generalMsg, setGeneralMsg] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(
    null,
  );
  const [updateBusy, setUpdateBusy] = useState(false);
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [piLoginBusy, setPiLoginBusy] = useState(false);

  const refreshProfiles = useCallback(async () => {
    setProfiles(await window.xAgent.listProviderProfiles());
  }, []);

  const existingIds = useMemo(
    () => new Set(form.models.map((m) => m.id.trim()).filter(Boolean)),
    [form.models],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [status, list, presetList, bashStatus, update] = await Promise.all([
        window.xAgent.godotRpcStatus(),
        window.xAgent.listProviderProfiles(),
        window.xAgent.listProviderPresets(),
        window.xAgent.checkBash(),
        window.xAgent.getUpdateStatus(),
      ]);
      if (cancelled) return;
      setRpc(status);
      setProfiles(list);
      setPresets(presetList);
      setBash(bashStatus);
      setUpdateStatus(update);
    })();
    const unsub = window.xAgent.onUpdateStatus((status) => {
      if (!cancelled) setUpdateStatus(status);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [open]);

  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  if (!open) return null;

  const refreshRpc = async () => {
    setRpc(await window.xAgent.godotRpcStatus());
  };

  const runRpc = async (call: GodotRpcCallDto) => {
    const res = await window.xAgent.godotRpcRequest(call);
    setRpcMsg(
      res.ok
        ? JSON.stringify(res.result, null, 2)
        : res.error ?? "request failed",
    );
    await refreshRpc();
  };

  const resetFetchPanel = () => {
    setShowFetchPanel(false);
    setFetched([]);
    setSelectedFetchIds(new Set());
  };

  const openCreate = () => {
    setForm(emptyForm());
    setEditing(true);
    setError(null);
    setShowPresetPicker(false);
    resetFetchPanel();
  };

  const openFromPreset = (preset: ProviderPreset) => {
    setForm({
      name: preset.name,
      providerId: preset.providerId,
      api: preset.api,
      baseUrl: preset.baseUrl,
      apiKey: "",
      models: preset.models.length ? preset.models : [{ id: "", name: "" }],
      notes: preset.notes,
    });
    setEditing(true);
    setShowPresetPicker(false);
    setError(null);
    resetFetchPanel();
  };

  const openEdit = async (id: string) => {
    const profile = await window.xAgent.getProviderProfile(id);
    if (!profile) {
      setError("档案不存在");
      return;
    }
    setForm({
      id: profile.id,
      name: profile.name,
      providerId: profile.providerId,
      api: profile.api,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      models: profile.models.length ? profile.models : [{ id: "", name: "" }],
      notes: profile.notes,
    });
    setEditing(true);
    setError(null);
    resetFetchPanel();
  };

  const updateModelRow = (
    index: number,
    patch: Partial<ProviderModelEntry>,
  ) => {
    setForm((prev) => {
      const models = prev.models.slice();
      models[index] = { ...models[index], ...patch };
      return { ...prev, models };
    });
  };

  const addModelRow = () => {
    setForm((prev) => ({
      ...prev,
      models: [...prev.models, { id: "", name: "" }],
    }));
  };

  const removeModelRow = (index: number) => {
    setForm((prev) => {
      const models = prev.models.filter((_, i) => i !== index);
      return {
        ...prev,
        models: models.length ? models : [{ id: "", name: "" }],
      };
    });
  };

  const fetchModels = async () => {
    setFetching(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.xAgent.fetchProviderModels({
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
      });
      if (!result.ok) {
        setError(result.error ?? "拉取模型失败");
        setShowFetchPanel(false);
        return;
      }
      const models = result.models ?? [];
      if (models.length === 0) {
        setError("端点返回空模型列表");
        setShowFetchPanel(false);
        return;
      }
      setFetched(models);
      const preselect = new Set(
        models.filter((m) => existingIds.has(m.id)).map((m) => m.id),
      );
      if (preselect.size === 0 && models.length <= 30) {
        for (const m of models) preselect.add(m.id);
      }
      setSelectedFetchIds(preselect);
      setShowFetchPanel(true);
      setMessage(`已拉取 ${models.length} 个模型，勾选后点击「加入表格」`);
    } finally {
      setFetching(false);
    }
  };

  const applyFetchedModels = (mode: "merge" | "replace") => {
    const chosen = fetched.filter((m) => selectedFetchIds.has(m.id));
    if (chosen.length === 0) {
      setError("请至少勾选一个模型");
      return;
    }
    const mapped: ProviderModelEntry[] = chosen.map((m) => ({
      id: m.id,
      name: m.id,
    }));
    if (mode === "replace") {
      setForm((prev) => ({ ...prev, models: mapped }));
    } else {
      setForm((prev) => {
        const seen = new Set(prev.models.map((x) => x.id.trim()).filter(Boolean));
        const next = prev.models.filter((m) => m.id.trim());
        for (const m of mapped) {
          if (!seen.has(m.id)) {
            next.push(m);
            seen.add(m.id);
          }
        }
        return {
          ...prev,
          models: next.length ? next : [{ id: "", name: "" }],
        };
      });
    }
    setShowFetchPanel(false);
    setMessage(
      mode === "replace"
        ? `已替换为 ${mapped.length} 个模型`
        : `已合并加入 ${mapped.length} 个模型`,
    );
  };

  const saveProfile = async (andActivate: boolean) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const input: ProviderUpsertInput = {
        ...form,
        models: form.models
          .map((m) => ({
            id: m.id.trim(),
            ...(m.name?.trim() ? { name: m.name.trim() } : {}),
          }))
          .filter((m) => m.id),
      };
      const result = await window.xAgent.upsertProviderProfile(input);
      if (!result.ok || !result.profile) {
        setError(result.error ?? "保存失败");
        return;
      }
      if (andActivate) {
        const act = await window.xAgent.activateProviderProfile(
          result.profile.id,
        );
        if (!act.ok) {
          setError(act.error ?? "启用失败");
          await refreshProfiles();
          return;
        }
        setMessage(`已保存并启用：${result.profile.name}`);
        onProvidersChanged?.();
      } else {
        setMessage(`已保存：${result.profile.name}`);
      }
      setEditing(false);
      resetFetchPanel();
      await refreshProfiles();
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.xAgent.activateProviderProfile(id);
      if (!result.ok) {
        setError(result.error ?? "启用失败");
        return;
      }
      setMessage(`已启用 ${result.provider}/${result.model}`);
      await refreshProfiles();
      onProvidersChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (profile: ProviderProfileSummary) => {
    if (!window.confirm(`删除订阅「${profile.name}」？`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.deleteProviderProfile(profile.id);
      if (!result.ok) {
        setError(result.error ?? "删除失败");
        return;
      }
      await refreshProfiles();
    } finally {
      setBusy(false);
    }
  };

  const importExisting = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.xAgent.importExistingProviderProfiles();
      if (!result.ok) {
        setError(result.error ?? "导入失败");
        return;
      }
      await refreshProfiles();
      const sourceLabel = result.sources.length
        ? `（来源：${result.sources.join("、")}）`
        : "";
      if (result.imported === 0) {
        setMessage(
          result.skipped > 0
            ? `没有新订阅可导入，已跳过 ${result.skipped} 条重复项${sourceLabel}`
            : "未在 Pi auth/models 或 cc-switch 中发现可导入的订阅",
        );
      } else {
        setMessage(
          `已导入 ${result.imported} 条订阅，跳过 ${result.skipped} 条${sourceLabel}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: "通用" },
    { id: "providers", label: "供应商" },
    { id: "tools", label: "工具" },
    { id: "plugins", label: "插件" },
    { id: "godot", label: "Godot RPC" },
  ];

  const toggleFetchId = (id: string) => {
    setSelectedFetchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFetched = (on: boolean) => {
    setSelectedFetchIds(on ? new Set(fetched.map((m) => m.id)) : new Set());
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel settings-modal"
        role="dialog"
        aria-label="设置"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>设置</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={
                  tab === t.id ? "settings-nav-item active" : "settings-nav-item"
                }
                onClick={() => {
                  setTab(t.id);
                  setEditing(false);
                  setShowPresetPicker(false);
                  resetFetchPanel();
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div
            className={
              tab === "plugins"
                ? "settings-content settings-content--plugins"
                : "settings-content"
            }
          >
            {(error || message) && (
              <div className={`banner ${error ? "error" : "warn"}`}>
                {error ?? message}
              </div>
            )}

            {tab === "general" && (
              <section>
                <h3>通用</h3>

                <h4 className="settings-subhead">外观</h4>
                <label className="settings-row">
                  <span className="settings-row-label">主题</span>
                  <select
                    className="settings-select"
                    value={prefs.theme}
                    onChange={async (e) => {
                      const theme = e.target.value as "light" | "dark";
                      const next = await window.xAgent.setPrefs({ theme });
                      onPrefsChanged?.(next);
                    }}
                    aria-label="主题"
                  >
                    <option value="dark">深色</option>
                    <option value="light">浅色</option>
                  </select>
                </label>

                <h4 className="settings-subhead">对话</h4>
                <label className="settings-row settings-row-check">
                  <span className="settings-row-label">显示思考过程</span>
                  <input
                    type="checkbox"
                    checked={prefs.showThinking}
                    onChange={async (e) => {
                      const next = await window.xAgent.setPrefs({
                        showThinking: e.target.checked,
                      });
                      onPrefsChanged?.(next);
                    }}
                  />
                </label>
                <label className="settings-row">
                  <span className="settings-row-label">默认 Thinking</span>
                  <select
                    className="settings-select"
                    value={prefs.thinkingLevel}
                    onChange={async (e) => {
                      const level = e.target.value as ThinkingLevel;
                      const applied =
                        await window.xAgent.setThinkingLevel(level);
                      if (applied.ok) {
                        const next = await window.xAgent.getPrefs();
                        onPrefsChanged?.(next);
                        setGeneralMsg(null);
                        return;
                      }
                      const next = await window.xAgent.setPrefs({
                        thinkingLevel: level,
                      });
                      onPrefsChanged?.(next);
                      setGeneralMsg(
                        "已保存默认 Thinking；打开项目后对当前会话生效。",
                      );
                    }}
                    aria-label="默认 Thinking 级别"
                  >
                    {THINKING_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>

                <h4 className="settings-subhead">Shell</h4>
                <p className="modal-hint">
                  Pi 的 bash 工具需要可用的 bash（Windows 上多为 Git Bash）。路径写入
                  ~/.pi/agent/settings.json。
                </p>
                <div className="godot-rpc-path-row">
                  <input
                    type="text"
                    className="input"
                    readOnly
                    value={bash?.shellPath ?? ""}
                    placeholder="尚未配置 shellPath…"
                    aria-label="当前 shellPath"
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      const status = await window.xAgent.checkBash();
                      setBash(status);
                      onBashChanged?.(status);
                      setGeneralMsg(status.message);
                    }}
                  >
                    检测
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!bash?.suggestedShellPath}
                    onClick={async () => {
                      const status = await window.xAgent.applyBashShellPath(
                        bash?.suggestedShellPath ?? undefined,
                      );
                      setBash(status);
                      onBashChanged?.(status);
                      setGeneralMsg(status.message);
                    }}
                  >
                    写入建议路径
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      const picked = await window.xAgent.pickBashShell();
                      if (picked.canceled || !picked.path) return;
                      const status = await window.xAgent.applyBashShellPath(
                        picked.path,
                      );
                      setBash(status);
                      onBashChanged?.(status);
                      setGeneralMsg(status.message);
                    }}
                  >
                    浏览…
                  </button>
                </div>
                {bash?.suggestedShellPath &&
                  bash.suggestedShellPath !== bash.shellPath && (
                    <p className="modal-hint">
                      建议路径：{bash.suggestedShellPath}
                    </p>
                  )}

                <h4 className="settings-subhead">认证</h4>
                <p className="modal-hint">
                  可用 Pi CLI 的 /login，或在「供应商」页配置 API Key。
                </p>
                <div className="godot-rpc-path-row">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={piLoginBusy}
                    onClick={async () => {
                      setPiLoginBusy(true);
                      setAuthHint(null);
                      try {
                        const result = await window.xAgent.openPiLogin();
                        setAuthHint(
                          result.hint ??
                            (result.ok
                              ? "已打开终端"
                              : result.error ?? "无法打开 Pi 登录"),
                        );
                        if (!result.ok && result.error) {
                          setGeneralMsg(result.error);
                        }
                      } finally {
                        setPiLoginBusy(false);
                      }
                    }}
                  >
                    {piLoginBusy ? "打开中…" : "打开 Pi 登录"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setTab("providers")}
                  >
                    前往供应商
                  </button>
                </div>
                {authHint && <p className="modal-hint">{authHint}</p>}

                <h4 className="settings-subhead">更新</h4>
                <p className="modal-hint">
                  {updateStatus?.message ??
                    "检查 GitHub Releases 上的新版本。"}
                  {updateStatus?.version
                    ? `（当前目标：${updateStatus.version}）`
                    : ""}
                  {typeof updateStatus?.progress === "number" &&
                  updateStatus.downloading
                    ? ` ${updateStatus.progress}%`
                    : ""}
                </p>
                <div className="godot-rpc-path-row">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={
                      updateBusy ||
                      updateStatus?.checking ||
                      updateStatus?.downloading
                    }
                    onClick={async () => {
                      setUpdateBusy(true);
                      try {
                        setUpdateStatus(await window.xAgent.checkForUpdates());
                      } finally {
                        setUpdateBusy(false);
                      }
                    }}
                  >
                    {updateStatus?.checking ? "检查中…" : "检查更新"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={
                      updateBusy ||
                      !updateStatus?.available ||
                      updateStatus.downloaded ||
                      updateStatus.downloading ||
                      !updateStatus.supported
                    }
                    onClick={async () => {
                      setUpdateBusy(true);
                      try {
                        setUpdateStatus(await window.xAgent.downloadUpdate());
                      } finally {
                        setUpdateBusy(false);
                      }
                    }}
                  >
                    {updateStatus?.downloading ? "下载中…" : "下载更新"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={
                      updateBusy ||
                      !updateStatus?.downloaded ||
                      !updateStatus.supported
                    }
                    onClick={async () => {
                      setUpdateBusy(true);
                      try {
                        const result = await window.xAgent.installUpdate();
                        if (!result.ok) {
                          setGeneralMsg(result.error ?? "安装失败");
                        }
                      } finally {
                        setUpdateBusy(false);
                      }
                    }}
                  >
                    安装并重启
                  </button>
                </div>
                {updateStatus?.error && (
                  <p className="modal-hint">{updateStatus.error}</p>
                )}

                {generalMsg && <p className="modal-hint">{generalMsg}</p>}
              </section>
            )}

            {tab === "tools" && (
              <section>
                <h3>启用工具</h3>
                <p className="modal-hint">
                  更改会立即应用到当前会话（若已打开项目）。右侧「工具」面板会显示已启用列表；实际调用记录在 Agent
                  运行后出现。
                </p>
                <h4 className="settings-subhead">内置</h4>
                <div className="tool-grid">
                  {AVAILABLE_TOOLS.map((tool) => {
                    const checked = prefs.tools.includes(tool);
                    return (
                      <label key={tool} className="tool-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleTool(tool)}
                        />
                        <span>{tool}</span>
                      </label>
                    );
                  })}
                </div>
                <h4 className="settings-subhead">Godot 编辑器</h4>
                <p className="modal-hint">
                  需启用 Godot RPC 插件并连接桌面桥；默认关闭。
                </p>
                <div className="tool-grid">
                  {GODOT_TOOLS.map((tool) => {
                    const checked = prefs.tools.includes(tool);
                    return (
                      <label key={tool} className="tool-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleTool(tool)}
                        />
                        <span>{tool}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            {tab === "godot" && (
              <section>
                <h3>Godot 编辑器 RPC</h3>
                <p className="modal-hint">
                  先选择本机 Godot 引擎，启动编辑器并启用 X-agent RPC
                  插件后，桥接才会有客户端连接。
                </p>

                <h4 className="settings-subhead">引擎路径</h4>
                <div className="godot-rpc-path-row">
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

                <h4 className="settings-subhead">RPC 桥接</h4>
                <p className="modal-hint">
                  桥接端口 {rpc?.port ?? 8765} ·{" "}
                  {!rpc?.running
                    ? "未启动"
                    : rpc.clients > 0
                      ? `已连接 Godot（${rpc.clients} 客户端）`
                      : "桥接运行中 · 等待 Godot 连接"}
                </p>
                {(rpc?.clientInfos?.length ?? 0) > 0 && (
                  <label className="field">
                    <span>活动编辑器客户端</span>
                    <select
                      className="select"
                      value={rpc?.activeClientId ?? ""}
                      onChange={async (e) => {
                        const id = e.target.value || null;
                        const res = await window.xAgent.godotRpcSetActiveClient(
                          id,
                        );
                        setRpc(res.status);
                        setRpcMsg(
                          id
                            ? `已切换活动客户端：${id.slice(0, 8)}…`
                            : "已清除活动客户端（将使用首个连接）",
                        );
                      }}
                    >
                      {rpc!.clientInfos.map((c) => (
                        <option key={c.id} value={c.id}>
                          {(c.projectPath || "unknown project").slice(-48)} ·{" "}
                          {c.godotVersion ?? "?"} · {c.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="modal-actions">
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
                    安装/更新 RPC 插件到当前项目
                  </button>
                </div>
                {rpc?.running && rpc.clients === 0 && (
                  <p className="modal-hint">
                    请「安装/更新 RPC 插件」并启用 X-agent RPC（不要用
                    godot_agent），然后重启 Godot。运行报错回传需要含
                    rpc_debugger.gd 的插件。
                  </p>
                )}
                {rpc?.warning && (
                  <p className="modal-hint">{rpc.warning}</p>
                )}
                {rpc?.error && (
                  <p className="modal-hint godot-rpc-error">{rpc.error}</p>
                )}
                {rpc?.lastEvent && (
                  <p className="modal-hint">
                    最近事件：{JSON.stringify(rpc.lastEvent)}
                  </p>
                )}
                <div className="modal-actions">
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
                            ? "Godot 尚未连入桥接（客户端为 0）。请先「安装/更新 RPC 插件到当前项目」，再重启编辑器。"
                            : res.error ?? "ping failed",
                        );
                      }
                      await refreshRpc();
                    }}
                  >
                    Ping
                  </button>
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

                <h4 className="settings-subhead">场景（需编辑器已连接）</h4>
                <div className="godot-rpc-path-row">
                  <input
                    type="text"
                    className="input"
                    value={scenePath}
                    onChange={(e) => setScenePath(e.target.value)}
                    placeholder="res://scenes/main.tscn"
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

                <h4 className="settings-subhead">资源导入</h4>
                <div className="godot-rpc-path-row">
                  <input
                    type="text"
                    className="input"
                    value={importPaths}
                    onChange={(e) => setImportPaths(e.target.value)}
                    placeholder="res://icon.svg（空则全量 scan；多路径用逗号分隔）"
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
                {rpcMsg && (
                  <pre className="godot-rpc-result modal-hint">{rpcMsg}</pre>
                )}
              </section>
            )}

            {tab === "plugins" && <PluginsPage cwd={cwd} />}

            {tab === "providers" && !editing && (
              <section>
                <div className="providers-head">
                  <div>
                    <h3>供应商 / 订阅</h3>
                    <p className="modal-hint">
                      首次打开会自动从 Pi 认证与 cc-switch 导入已有订阅；也可随时手动同步。
                    </p>
                  </div>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void importExisting()}
                      title="从 Pi auth.json / models.json 与 cc-switch 导入"
                    >
                      <Import size={13} />
                      导入已有
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowPresetPicker((v) => !v)}
                    >
                      从预设添加
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={openCreate}
                    >
                      <Plus size={13} />
                      新建
                    </button>
                  </div>
                </div>

                {showPresetPicker && (
                  <div className="preset-grid">
                    {presets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="preset-card"
                        onClick={() => openFromPreset(p)}
                      >
                        <strong>{p.name}</strong>
                        <span>{p.baseUrl}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="provider-list">
                  {profiles.length === 0 && (
                    <div className="session-empty">
                      暂无订阅档案。可点击「导入已有」从 Pi / cc-switch 同步，或新建 / 从预设添加。
                    </div>
                  )}
                  {profiles.map((p) => (
                    <div
                      key={p.id}
                      className={
                        p.active ? "provider-card active" : "provider-card"
                      }
                    >
                      <div className="provider-card-main">
                        <div className="provider-card-title">
                          {p.name}
                          {p.active && (
                            <span className="provider-badge">当前启用</span>
                          )}
                        </div>
                        <div className="provider-card-meta">
                          {p.providerId} · {p.api} · {p.modelCount} 模型 ·{" "}
                          {p.apiKeyHint}
                        </div>
                        <div className="provider-card-meta">{p.baseUrl}</div>
                      </div>
                      <div className="provider-card-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy || p.active}
                          onClick={() => void activate(p.id)}
                        >
                          <Check size={13} />
                          启用
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => void openEdit(p.id)}
                        >
                          <Pencil size={13} />
                          编辑
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => void remove(p)}
                        >
                          <Trash2 size={13} />
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {tab === "providers" && editing && (
              <section>
                <div className="providers-head">
                  <h3>{form.id ? "编辑订阅" : "新建订阅"}</h3>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setEditing(false);
                      resetFetchPanel();
                    }}
                  >
                    返回列表
                  </button>
                </div>

                <label className="field block-field">
                  显示名称
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="DeepSeek 主号"
                  />
                </label>
                <label className="field block-field">
                  Provider ID
                  <input
                    value={form.providerId}
                    onChange={(e) =>
                      setForm({ ...form, providerId: e.target.value })
                    }
                    placeholder="deepseek"
                  />
                </label>
                <label className="field block-field">
                  API 类型
                  <select
                    value={form.api}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        api: e.target.value as ProviderApiKind,
                      })
                    }
                  >
                    {API_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field block-field">
                  Base URL
                  <input
                    value={form.baseUrl}
                    onChange={(e) =>
                      setForm({ ...form, baseUrl: e.target.value })
                    }
                    placeholder="https://api.example.com/v1"
                  />
                </label>
                <label className="field block-field">
                  API Key
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) =>
                      setForm({ ...form, apiKey: e.target.value })
                    }
                    placeholder="sk-..."
                    autoComplete="off"
                  />
                </label>

                <div className="models-table-section">
                  <div className="models-table-head">
                    <h4>模型列表</h4>
                    <div className="modal-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={
                          fetching || !form.baseUrl.trim() || !form.apiKey.trim()
                        }
                        onClick={() => void fetchModels()}
                        title="从供应商 OpenAI 兼容 /models 端点拉取"
                      >
                        <Download size={13} />
                        {fetching ? "拉取中…" : "拉取模型"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={addModelRow}
                      >
                        <Plus size={13} />
                        添加行
                      </button>
                    </div>
                  </div>
                  <p className="modal-hint">
                    参考 cc-switch：填写 Base URL 与 API Key 后可自动拉取；表格内可直接改 id /
                    显示名。
                  </p>

                  <div className="models-table-wrap">
                    <table className="models-table">
                      <thead>
                        <tr>
                          <th style={{ width: "42%" }}>模型 ID</th>
                          <th style={{ width: "42%" }}>显示名</th>
                          <th style={{ width: "16%" }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {form.models.map((row, index) => (
                          <tr key={`model-row-${index}`}>
                            <td>
                              <input
                                value={row.id}
                                onChange={(e) =>
                                  updateModelRow(index, { id: e.target.value })
                                }
                                placeholder="model-id"
                              />
                            </td>
                            <td>
                              <input
                                value={row.name ?? ""}
                                onChange={(e) =>
                                  updateModelRow(index, {
                                    name: e.target.value,
                                  })
                                }
                                placeholder="可选显示名"
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => removeModelRow(index)}
                                title="删除"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {showFetchPanel && (
                    <div className="fetch-models-panel">
                      <div className="models-table-head">
                        <h4>拉取结果（{fetched.length}）</h4>
                        <div className="modal-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => selectAllFetched(true)}
                          >
                            全选
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => selectAllFetched(false)}
                          >
                            清空
                          </button>
                        </div>
                      </div>
                      <div className="models-table-wrap fetch-table-wrap">
                        <table className="models-table">
                          <thead>
                            <tr>
                              <th style={{ width: "40px" }} />
                              <th>模型 ID</th>
                              <th>owned_by</th>
                              <th style={{ width: "72px" }}>状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fetched.map((m) => {
                              const already = existingIds.has(m.id);
                              return (
                                <tr key={m.id}>
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={selectedFetchIds.has(m.id)}
                                      onChange={() => toggleFetchId(m.id)}
                                    />
                                  </td>
                                  <td className="tabular">{m.id}</td>
                                  <td className="muted-cell">
                                    {m.ownedBy ?? "—"}
                                  </td>
                                  <td className="muted-cell">
                                    {already ? "已有" : "新"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="modal-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => applyFetchedModels("merge")}
                        >
                          合并加入表格
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => applyFetchedModels("replace")}
                        >
                          替换为所选
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={resetFetchPanel}
                        >
                          关闭
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <label className="field block-field">
                  备注
                  <input
                    value={form.notes ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                  />
                </label>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => void saveProfile(false)}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void saveProfile(true)}
                  >
                    保存并启用
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
