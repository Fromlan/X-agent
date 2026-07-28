import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CheckSquare,
  Check,
  ChartColumn,
  Download,
  Gamepad2,
  Import,
  Pencil,
  Plus,
  Puzzle,
  Settings2,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  AVAILABLE_TOOLS,
  GODOT_DOCS_PRESET_BRANCHES,
  GODOT_DOCS_TOOLS,
  GODOT_TOOLS,
  type AppUpdateStatus,
  type BashCheckResult,
  type ClientPrefs,
  type FetchedProviderModel,
  type GodotDocsStatusDto,
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
import { UsageSettingsPage } from "./UsageSettingsPage";

type SettingsTab =
  | "general"
  | "providers"
  | "tools"
  | "plugins"
  | "godot"
  | "usage";
type GodotSettingsSection = "editor" | "docs";
type PresetCategory = NonNullable<ProviderPreset["category"]> | "all";

const PRESET_CATEGORY_TABS: { id: PresetCategory; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "cn", label: "国内" },
  { id: "official", label: "官方" },
  { id: "aggregator", label: "聚合" },
  { id: "compatible", label: "兼容" },
  { id: "custom", label: "自定义" },
];

function presetCategoryLabel(category: ProviderPreset["category"]): string {
  switch (category) {
    case "cn":
      return "国内";
    case "official":
      return "官方";
    case "aggregator":
      return "聚合";
    case "compatible":
      return "兼容";
    case "custom":
      return "自定义";
    default:
      return "其他";
  }
}

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
  const [godotSection, setGodotSection] =
    useState<GodotSettingsSection>("editor");
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
  const [profiles, setProfiles] = useState<ProviderProfileSummary[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProviderUpsertInput>(emptyForm());
  const [showPresetPicker, setShowPresetPicker] = useState(false);
  const [presetQuery, setPresetQuery] = useState("");
  const [presetCategory, setPresetCategory] = useState<PresetCategory>("all");
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
      const [status, list, presetList, bashStatus, update, docs, remote] =
        await Promise.all([
          window.xAgent.godotRpcStatus(),
          window.xAgent.listProviderProfiles(),
          window.xAgent.listProviderPresets(),
          window.xAgent.checkBash(),
          window.xAgent.getUpdateStatus(),
          window.xAgent.godotDocsGetStatus(),
          window.xAgent.godotDocsListRemoteBranches(false),
        ]);
      if (cancelled) return;
      setRpc(status);
      setProfiles(list);
      setPresets(presetList);
      setBash(bashStatus);
      setUpdateStatus(update);
      setDocsStatus(remote.status ?? docs);
      const branches =
        remote.branches.length > 0
          ? remote.branches
          : docs.remoteBranches.length > 0
            ? docs.remoteBranches
            : [...GODOT_DOCS_PRESET_BRANCHES];
      setDocsBranches(branches);
      if (docs.branch && !branches.includes(docs.branch)) {
        setDocsCustomBranch(docs.branch);
      }
      if (!remote.ok && remote.error) {
        setDocsMsg(`远程分支列表：${remote.error}`);
      }
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

  const filteredPresets = useMemo(() => {
    const q = presetQuery.trim().toLowerCase();
    return presets.filter((p) => {
      if (
        presetCategory !== "all" &&
        (p.category ?? "custom") !== presetCategory
      ) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.providerId.toLowerCase().includes(q) ||
        p.baseUrl.toLowerCase().includes(q) ||
        (p.notes?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [presets, presetCategory, presetQuery]);

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

  const tabs: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
    { id: "general", label: "通用", icon: Settings2 },
    { id: "providers", label: "供应商", icon: Boxes },
    { id: "usage", label: "用量", icon: ChartColumn },
    { id: "tools", label: "工具", icon: Wrench },
    { id: "plugins", label: "插件", icon: Puzzle },
    { id: "godot", label: "Godot", icon: Gamepad2 },
  ];

  const openGodotSection = (section: GodotSettingsSection) => {
    setTab("godot");
    setGodotSection(section);
    setEditing(false);
    setShowPresetPicker(false);
    resetFetchPanel();
  };

  const rpcTone = rpcStatusLabel(rpc);
  const docsTone = docsStatusLabel(docsStatus?.status);
  const allBuiltinToolsEnabled = AVAILABLE_TOOLS.every((tool) =>
    prefs.tools.includes(tool),
  );
  const allGodotEditorToolsEnabled = GODOT_TOOLS.every((tool) =>
    prefs.tools.includes(tool),
  );
  const allGodotDocsToolsEnabled = GODOT_DOCS_TOOLS.every((tool) =>
    prefs.tools.includes(tool),
  );

  const setToolGroupEnabled = async (
    tools: readonly string[],
    enabled: boolean,
  ) => {
    const withoutGroup = prefs.tools.filter((tool) => !tools.includes(tool));
    const nextTools = enabled ? [...withoutGroup, ...tools] : withoutGroup;
    const next = await window.xAgent.setPrefs({ tools: nextTools });
    onPrefsChanged?.(next);
  };

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
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={
                    tab === t.id
                      ? "settings-nav-item active"
                      : "settings-nav-item"
                  }
                  onClick={() => {
                    setTab(t.id);
                    setEditing(false);
                    setShowPresetPicker(false);
                    resetFetchPanel();
                  }}
                >
                  <Icon size={14} />
                  {t.label}
                </button>
              );
            })}
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
              <section className="settings-page">
                <div className="settings-page-head">
                  <h3>通用</h3>
                  <p className="modal-hint">外观、对话、Shell、认证与更新</p>
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">外观</h4>
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
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">对话</h4>
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
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">Shell</h4>
                  <p className="modal-hint">
                    Pi 的 bash 工具需要可用的 bash（Windows 上多为 Git
                    Bash）。路径写入 ~/.pi/agent/settings.json。
                  </p>
                  <div className="settings-inline-row">
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
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">认证</h4>
                  <p className="modal-hint">
                    可用 Pi CLI 的 /login，或在「供应商」页配置 API Key。
                  </p>
                  <div className="settings-inline-row">
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
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">更新</h4>
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
                  <div className="settings-inline-row">
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
                          setUpdateStatus(
                            await window.xAgent.checkForUpdates(),
                          );
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
                    <p className="modal-hint settings-error">
                      {updateStatus.error}
                    </p>
                  )}
                </div>

                {generalMsg && <p className="modal-hint">{generalMsg}</p>}
              </section>
            )}

            {tab === "usage" && <UsageSettingsPage active={tab === "usage"} />}

            {tab === "tools" && (
              <section className="settings-page">
                <div className="settings-page-head">
                  <h3>启用工具</h3>
                  <p className="modal-hint">
                    更改会立即应用到当前会话（若已打开项目）。右侧「工具」面板显示已启用列表；实际调用记录在
                    Agent 运行后出现。
                  </p>
                </div>

                <div className="settings-block">
                  <div className="settings-block-head">
                    <h4 className="settings-block-title">内置</h4>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm settings-link-btn"
                      title={allBuiltinToolsEnabled ? "全部关闭" : "全部开启"}
                      aria-label={allBuiltinToolsEnabled ? "全部关闭" : "全部开启"}
                      onClick={() => {
                        void setToolGroupEnabled(
                          AVAILABLE_TOOLS,
                          !allBuiltinToolsEnabled,
                        );
                      }}
                    >
                      {allBuiltinToolsEnabled ? (
                        <CheckSquare size={14} />
                      ) : (
                        <Square size={14} />
                      )}
                    </button>
                  </div>
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
                </div>

                <div className="settings-block">
                  <div className="settings-block-head">
                    <h4 className="settings-block-title">Godot 编辑器</h4>
                    <div className="settings-toolbar">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title={allGodotEditorToolsEnabled ? "全部关闭" : "全部开启"}
                        aria-label={
                          allGodotEditorToolsEnabled ? "全部关闭" : "全部开启"
                        }
                        onClick={() => {
                          void setToolGroupEnabled(
                            GODOT_TOOLS,
                            !allGodotEditorToolsEnabled,
                          );
                        }}
                      >
                        {allGodotEditorToolsEnabled ? (
                          <CheckSquare size={14} />
                        ) : (
                          <Square size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm settings-link-btn"
                        onClick={() => openGodotSection("editor")}
                      >
                        连接与 RPC 设置
                      </button>
                    </div>
                  </div>
                  <p className="modal-hint">
                    需启用 RPC 插件并连接桌面桥；默认关闭。
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
                </div>

                <div className="settings-block">
                  <div className="settings-block-head">
                    <h4 className="settings-block-title">Godot 文档</h4>
                    <div className="settings-toolbar">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title={allGodotDocsToolsEnabled ? "全部关闭" : "全部开启"}
                        aria-label={
                          allGodotDocsToolsEnabled ? "全部关闭" : "全部开启"
                        }
                        onClick={() => {
                          void setToolGroupEnabled(
                            GODOT_DOCS_TOOLS,
                            !allGodotDocsToolsEnabled,
                          );
                        }}
                      >
                        {allGodotDocsToolsEnabled ? (
                          <CheckSquare size={14} />
                        ) : (
                          <Square size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm settings-link-btn"
                        onClick={() => openGodotSection("docs")}
                      >
                        文档缓存设置
                      </button>
                    </div>
                  </div>
                  <p className="modal-hint">
                    离线检索官方 godot-docs；需先导入 zip。默认关闭。
                  </p>
                  <div className="tool-grid">
                    {GODOT_DOCS_TOOLS.map((tool) => {
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
                </div>
              </section>
            )}

            {tab === "godot" && (
              <section className="settings-page">
                <div className="settings-page-head">
                  <h3>Godot</h3>
                  <p className="modal-hint">
                    编辑器 RPC 与官方文档离线检索，分别在下方页签配置。
                  </p>
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
                    onClick={() => setGodotSection("editor")}
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
                    onClick={() => setGodotSection("docs")}
                  >
                    官方文档
                  </button>
                </div>

                {godotSection === "editor" && (
                  <>
                    <div className="settings-block">
                      <h4 className="settings-block-title">引擎</h4>
                      <p className="modal-hint">
                        选择本机 Godot 可执行文件，并可从此处启动编辑器。
                      </p>
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
                        端口 {rpc?.port ?? 8765}。先安装插件并启动桥接，再在 Godot
                        中启用 X-agent RPC（不要用 godot_agent）。
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
                          桥接已运行但尚无客户端。请安装插件、启用 X-agent RPC
                          后重启 Godot。
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
                      <p className="modal-hint">调试（需编辑器已连接）</p>
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
                      <p className="modal-hint">需编辑器已连接。</p>
                      <div className="settings-inline-row">
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
                    </div>

                    <div className="settings-block">
                      <h4 className="settings-block-title">资源导入</h4>
                      <p className="modal-hint">
                        空路径则全量扫描；多路径用逗号分隔。
                      </p>
                      <div className="settings-inline-row">
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
                    </div>

                    {rpcMsg && (
                      <pre className="settings-result">{rpcMsg}</pre>
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
                        下载 GitHub 源码 zip（需含 .rst，不要 HTML offline
                        包），导入后 Agent 工具 godot_docs_search 才能检索。
                      </p>
                <label className="field">
                  <span>文档版本分支</span>
                  <select
                    className="select"
                    value={
                      docsBranches.includes(prefs.godotDocsBranch)
                        ? prefs.godotDocsBranch
                        : "__custom__"
                    }
                    onChange={async (e) => {
                      const v = e.target.value;
                      if (v === "__custom__") {
                        const custom =
                          docsCustomBranch.trim() || prefs.godotDocsBranch;
                        const res = await window.xAgent.godotDocsSetBranch(
                          custom,
                        );
                        if (res.status) setDocsStatus(res.status);
                        if (res.ok) {
                          const next = await window.xAgent.getPrefs();
                          onPrefsChanged?.(next);
                          setDocsMsg(`已选择自定义分支：${next.godotDocsBranch}`);
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
                    }}
                  >
                    {docsBranches.map((b) => (
                      <option key={b} value={b}>
                        {branchLabel(b)}
                      </option>
                    ))}
                    <option value="__custom__">自定义…</option>
                  </select>
                </label>
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
                    {docsMsg && <p className="modal-hint">{docsMsg}</p>}
                  </>
                )}
              </section>
            )}

            {tab === "plugins" && <PluginsPage cwd={cwd} />}

            {tab === "providers" && !editing && (
              <section className="settings-page">
                <div className="providers-head">
                  <div>
                    <h3>供应商 / 订阅</h3>
                    <p className="modal-hint">
                      首次打开会自动从 Pi 认证与 cc-switch 导入已有订阅；也可随时手动同步。预设列表参考
                      cc-switch，覆盖国内厂商、聚合中转与官方兼容模板。
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
                      onClick={() => {
                        setShowPresetPicker((v) => {
                          const next = !v;
                          if (next) {
                            setPresetQuery("");
                            setPresetCategory("all");
                          }
                          return next;
                        });
                      }}
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
                  <div className="preset-panel">
                    <div className="preset-panel-head">
                      <input
                        type="search"
                        className="input"
                        value={presetQuery}
                        onChange={(e) => setPresetQuery(e.target.value)}
                        placeholder="搜索预设名称 / 域名…"
                        aria-label="搜索供应商预设"
                      />
                      <span className="preset-panel-count">
                        {filteredPresets.length}/{presets.length}
                      </span>
                    </div>
                    <div className="preset-category-tabs" role="tablist">
                      {PRESET_CATEGORY_TABS.map((tabItem) => (
                        <button
                          key={tabItem.id}
                          type="button"
                          role="tab"
                          aria-selected={presetCategory === tabItem.id}
                          className={
                            presetCategory === tabItem.id
                              ? "preset-category-tab active"
                              : "preset-category-tab"
                          }
                          onClick={() => setPresetCategory(tabItem.id)}
                        >
                          {tabItem.label}
                        </button>
                      ))}
                    </div>
                    <div className="preset-grid">
                      {filteredPresets.length === 0 ? (
                        <div className="session-empty">没有匹配的预设</div>
                      ) : (
                        filteredPresets.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="preset-card"
                            title={p.notes ?? p.baseUrl}
                            onClick={() => openFromPreset(p)}
                          >
                            <div className="preset-card-top">
                              <strong>{p.name}</strong>
                              <span className="preset-card-badge">
                                {presetCategoryLabel(p.category)}
                              </span>
                            </div>
                            <span className="preset-card-api">{p.api}</span>
                            <span className="preset-card-url">{p.baseUrl}</span>
                          </button>
                        ))
                      )}
                    </div>
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
                          className="btn btn-primary btn-icon"
                          disabled={busy || p.active}
                          title="启用"
                          aria-label="启用"
                          onClick={() => void activate(p.id)}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          disabled={busy}
                          title="编辑"
                          aria-label="编辑"
                          onClick={() => void openEdit(p.id)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          disabled={busy}
                          title="删除"
                          aria-label="删除"
                          onClick={() => void remove(p)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {tab === "providers" && editing && (
              <section className="settings-page">
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
