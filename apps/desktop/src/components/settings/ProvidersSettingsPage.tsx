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
import { SelectMenu } from "../SelectMenu";
import { useAutoClearNotice } from "../SettingsNotice";
import {
  type FetchedProviderModel,
  type ProviderApiKind,
  type ProviderModelEntry,
  type ProviderPreset,
  type ProviderProfileSummary,
  type ProviderUpsertInput,
} from "@shared/ipc";
import {
  lookupKnownContextWindow,
  normalizePositiveInt,
  resolveModelContextWindow,
} from "@shared/model-context";
import { useConfirm } from "@/lib/app-confirm";

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

type Props = {
  open: boolean;
  onProvidersChanged?: () => void;
};

export function ProvidersSettingsPage({ open, onProvidersChanged }: Props) {
  const confirm = useConfirm();
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
      const [list, presetList] = await Promise.all([
        window.xAgent.listProviderProfiles(),
        window.xAgent.listProviderPresets(),
      ]);
      if (cancelled) return;
      setProfiles(list);
      setPresets(presetList);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    setError(null);
    setMessage(null);
    setEditing(false);
    setShowPresetPicker(false);
    setShowFetchPanel(false);
    setFetched([]);
    setSelectedFetchIds(new Set());
  }, [open]);

  useAutoClearNotice(message, () => setMessage(null), 4500, !error);

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

  /** When model id loses focus and context is empty, fill from known table. */
  const autofillContextForRow = (index: number) => {
    setForm((prev) => {
      const row = prev.models[index];
      if (!row?.id.trim()) return prev;
      if (normalizePositiveInt(row.contextWindow) != null) return prev;
      const resolved = lookupKnownContextWindow(row.id);
      if (resolved == null) return prev;
      const models = prev.models.slice();
      models[index] = { ...row, contextWindow: resolved };
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
    const mapped: ProviderModelEntry[] = chosen.map((m) => {
      const contextWindow = resolveModelContextWindow({
        id: m.id,
        fromApi: m.contextWindow,
      });
      return {
        id: m.id,
        name: m.id,
        ...(contextWindow != null ? { contextWindow } : {}),
      };
    });
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
          .map((m) => {
            const id = m.id.trim();
            if (!id) return null;
            const name = m.name?.trim();
            const explicit = normalizePositiveInt(m.contextWindow);
            const contextWindow = resolveModelContextWindow({
              id,
              explicit,
            });
            return {
              id,
              ...(name ? { name } : {}),
              ...(contextWindow != null ? { contextWindow } : {}),
            };
          })
          .filter((m): m is ProviderModelEntry => !!m),
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
    const ok = await confirm({
      title: "删除订阅",
      message: `删除订阅「${profile.name}」？`,
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
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
    <>
      {(error || message) && (
        <div className={`banner ${error ? "error" : "warn"}`}>
          <span>{error ?? message}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            title="关闭提示"
            aria-label="关闭提示"
            onClick={() => {
              setError(null);
              setMessage(null);
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {!editing && (
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
                className={p.active ? "provider-card active" : "provider-card"}
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

      {editing && (
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
          <div className="field block-field">
            API 类型
            <SelectMenu
              variant="block"
              value={form.api}
              options={API_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              onChange={(v) =>
                setForm({
                  ...form,
                  api: v as ProviderApiKind,
                })
              }
              aria-label="API 类型"
            />
          </div>
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
                  添加
                </button>
              </div>
            </div>
            <p className="modal-hint">
              上下文写入 Pi models.json 的 contextWindow；留空则 Pi
              默认 128k。已知模型与拉取结果会自动填入。
            </p>
            <div className="models-table-wrap">
              <table className="models-table">
                <thead>
                  <tr>
                    <th style={{ width: "34%" }}>模型 ID</th>
                    <th style={{ width: "28%" }}>显示名</th>
                    <th style={{ width: "22%" }}>上下文</th>
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
                          onBlur={() => autofillContextForRow(index)}
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
                        <input
                          className="tabular"
                          inputMode="numeric"
                          value={
                            row.contextWindow != null
                              ? String(row.contextWindow)
                              : ""
                          }
                          onChange={(e) => {
                            const digits = e.target.value.replace(
                              /[^\d]/g,
                              "",
                            );
                            if (!digits) {
                              updateModelRow(index, {
                                contextWindow: undefined,
                              });
                              return;
                            }
                            const n = normalizePositiveInt(digits);
                            if (n != null) {
                              updateModelRow(index, {
                                contextWindow: n,
                              });
                            }
                          }}
                          placeholder="自动 / 128k"
                          title="上下文窗口（tokens）"
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
                        <th style={{ width: "88px" }}>上下文</th>
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
                            <td className="muted-cell tabular">
                              {m.contextWindow != null
                                ? m.contextWindow.toLocaleString()
                                : "—"}
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
    </>
  );
}
