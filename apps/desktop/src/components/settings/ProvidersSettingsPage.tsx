import { useCallback, useEffect, useMemo, useState } from "react";
import {
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
  type ModelInput,
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
  models: [{ id: "", name: "", input: ["text"] }],
  notes: "",
});

/** 工具: 把"行级 input 字段"规整成数组,缺省视为 ["text"]。 */
function normalizeRowInput(input: unknown): ModelInput[] {
  if (!Array.isArray(input)) return ["text"];
  const filtered = input.filter(
    (v): v is ModelInput => v === "text" || v === "image",
  );
  return filtered.length > 0 ? filtered : ["text"];
}

/** 切换一个 input 类型。返回 null 表示拒绝(因取消到空)。 */
function toggleRowInput(
  current: ModelInput[] | undefined,
  kind: ModelInput,
): ModelInput[] | null {
  const base = normalizeRowInput(current);
  const has = base.includes(kind);
  if (has) {
    if (base.length === 1) return null; // 至少 1 个,不允许取消到空
    return base.filter((x) => x !== kind);
  }
  // 不去重 —— ["text","text"] 也合法, Pi SDK / renderer 都按 includes 判断。
  return [...base, kind];
}

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
    setProfiles(await window.xAgent.provider.listProfiles());
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
        window.xAgent.provider.listProfiles(),
        window.xAgent.provider.listPresets(),
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
      models: preset.models.length
        ? preset.models.map((m) => ({
            ...m,
            input: normalizeRowInput(m.input),
          }))
        : [{ id: "", name: "", input: ["text"] }],
      notes: preset.notes,
    });
    setEditing(true);
    setShowPresetPicker(false);
    setError(null);
    resetFetchPanel();
  };

  const openEdit = async (id: string) => {
    const profile = await window.xAgent.provider.getProfile(id);
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
      // form state 保留档案的原始 input (undefined / 实际值)。
      // 表格渲染时用 normalizeRowInput 兜底显示 ["text"],但不动 form state
      // —— saveProfile 只透传 form state, undefined 时不写 input 字段,
      // 保留"未表态 = 不写"语义。
      models: profile.models.length
        ? profile.models
        : [{ id: "", name: "", input: ["text"] }],
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
      models: [...prev.models, { id: "", name: "", input: ["text"] }],
    }));
  };

  /**
   * 切换一个 row 的 input 类型。返回 false 表示拒绝(因取消到空)——
   * UI 应当给一个轻量反馈(此处仅静默, 后端 validateUpsert 也会拒绝)。
   */
  const toggleInputKind = (index: number, kind: ModelInput) => {
    setForm((prev) => {
      const models = prev.models.slice();
      const row = models[index];
      if (!row) return prev;
      const next = toggleRowInput(row.input, kind);
      if (next == null) {
        // 不允许空: 短暂报错提示。沿用 error 文案风格, 不抢 banner 槽。
        setError("至少需要勾选一个输入类型（text / image）");
        return prev;
      }
      models[index] = { ...row, input: next };
      return { ...prev, models };
    });
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
      const result = await window.xAgent.provider.fetchModels({
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
        // OpenAI 兼容 /v1/models 不返回 input 字段; 缺省按 ["text"] 兜底。
        // 用户在 chip 切换时再显式表态是否支持 image。
        input: ["text"],
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

  const saveProfile = async () => {
    const providerId = form.providerId.trim();
    const conflict = profiles.find(
      (p) =>
        p.providerId === providerId &&
        (!form.id || p.id !== form.id),
    );
    if (conflict) {
      const proceed = await confirm({
        title: "覆盖同 providerId",
        message: `已有档案「${conflict.name}」使用相同 providerId「${providerId}」。保存后将覆盖顶栏中该 provider 的模型列表。是否继续？`,
        confirmLabel: "继续保存",
      });
      if (!proceed) return;
    }

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
            // input 透传 form state: undefined 不写,["text"] / ["text","image"]
            // 透传。后端 validateUpsert 会校验"若给出则至少 1 个有效值"。
            return {
              id,
              ...(name ? { name } : {}),
              ...(contextWindow != null ? { contextWindow } : {}),
              ...(m.input !== undefined && m.input.length > 0
                ? { input: m.input }
                : {}),
            };
          })
          .filter((m): m is ProviderModelEntry => !!m),
      };
      const result = await window.xAgent.provider.upsertProfile(input);
      if (!result.ok || !result.profile) {
        setError(result.error ?? "保存失败");
        return;
      }
      setMessage(
        result.syncedToPi
          ? `已保存：${result.profile.name}（已启用，模型在顶栏）`
          : `已保存：${result.profile.name}`,
      );
      onProvidersChanged?.();
      setEditing(false);
      resetFetchPanel();
      await refreshProfiles();
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (profile: ProviderProfileSummary, enabled: boolean) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.xAgent.provider.setProfileEnabled(
        profile.id,
        enabled,
      );
      if (!result.ok) {
        setError(result.error ?? "切换启用状态失败");
        return;
      }
      setMessage(
        enabled
          ? `已启用 ${profile.name}（模型已出现在顶栏）`
          : `已关闭 ${profile.name}（已从顶栏移除）`,
      );
      await refreshProfiles();
      onProvidersChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (profile: ProviderProfileSummary) => {
    const enabledCount = profiles.filter((x) => x.enabled).length;
    if (profile.enabled && enabledCount <= 1) {
      setError("至少需要保留一个启用的供应商，无法删除");
      return;
    }
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
      const result = await window.xAgent.provider.deleteProfile(profile.id);
      if (!result.ok) {
        setError(result.error ?? "删除失败");
        return;
      }
      await refreshProfiles();
      onProvidersChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const importExisting = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.xAgent.provider.importExisting();
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
                  setShowPresetPicker((v) => !v);
                  setPresetQuery("");
                  setPresetCategory("all");
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
            {profiles.map((p) => {
              const enabledCount = profiles.filter((x) => x.enabled).length;
              // 当前档案是唯一启用项时,关闭按钮置灰并解释原因。
              const isLastEnabled = p.enabled && enabledCount <= 1;
              const toggleTitle = isLastEnabled
                ? "至少需要保留一个启用的供应商"
                : p.enabled
                  ? "关闭后从顶栏移除"
                  : "启用后出现在顶栏";
              return (
              <div
                key={p.id}
                className={
                  p.enabled
                    ? "provider-card"
                    : "provider-card provider-card--disabled"
                }
              >
                <div className="provider-card-main">
                  <div className="provider-card-title">{p.name}</div>
                  <div className="provider-card-meta">
                    {p.providerId} · {p.api} · {p.modelCount} 模型 ·{" "}
                    {p.apiKeyHint}
                  </div>
                  <div className="provider-card-meta">{p.baseUrl}</div>
                </div>
                <div className="provider-card-actions">
                  <label
                    className="provider-card-toggle"
                    title={toggleTitle}
                  >
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      disabled={busy || isLastEnabled}
                      onChange={(e) => void setEnabled(p, e.target.checked)}
                      aria-label={
                        p.enabled ? `关闭 ${p.name}` : `启用 ${p.name}`
                      }
                    />
                  </label>
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
              );
            })}
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
              写入 models.json 的 contextWindow；留空默认 128k。输入 chip 决定
              是否支持 image —— 未勾 image 时 composer 会挡住截图附件。
            </p>
            <div className="models-table-wrap">
              <table className="models-table">
                <thead>
                  <tr>
                    <th style={{ width: "30%" }}>模型 ID</th>
                    <th style={{ width: "24%" }}>显示名</th>
                    <th style={{ width: "20%" }}>上下文</th>
                    <th style={{ width: "14%" }}>输入</th>
                    <th style={{ width: "12%" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {form.models.map((row, index) => {
                    const rowInput = normalizeRowInput(row.input);
                    return (
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
                          <div className="input-chip-row">
                            {(["text", "image"] as ModelInput[]).map((kind) => {
                              const on = rowInput.includes(kind);
                              return (
                                <button
                                  key={kind}
                                  type="button"
                                  className={
                                    on
                                      ? "input-chip input-chip--on"
                                      : "input-chip"
                                  }
                                  aria-pressed={on}
                                  title={
                                    kind === "image"
                                      ? on
                                        ? "该模型支持图片输入"
                                        : "点击开启 image 输入能力（vision 模型）"
                                      : on
                                        ? "该模型支持文字输入"
                                        : "点击关闭 text（不允许空）"
                                  }
                                  onClick={() => toggleInputKind(index, kind)}
                                >
                                  {kind}
                                </button>
                              );
                            })}
                          </div>
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
                    );
                  })}
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
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void saveProfile()}
            >
              保存
            </button>
          </div>
        </section>
      )}
    </>
  );
}
