/** Configure web-tool credentials through provider summaries so API keys stay in the main process. */
import { useEffect, useState } from "react";
import { WEB_TOOLS, type ClientPrefs, type ModelInfo, type ProviderProfileSummary } from "@shared/ipc";
import { isDeepSeekWebProvider } from "@shared/tools/web";
import { SelectMenu } from "../SelectMenu";
import { SettingsNotice } from "../SettingsNotice";

type Props = {
  prefs: ClientPrefs;
  onToggleTool: (tool: string) => void;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
  onOpenProviders: () => void;
};

/** The provider summary encodes an absent or undecryptable key using the store's empty-key hint. */
function hasKey(profile: ProviderProfileSummary): boolean {
  return Boolean(profile.apiKeyHint && profile.apiKeyHint !== "(未设置)");
}

/** Keep credential selection independent of the current model and preserve unavailable saved selections. */
export function DeepSeekWebSettings({ prefs, onToggleTool, onPrefsChanged, onOpenProviders }: Props) {
  const [profiles, setProfiles] = useState<ProviderProfileSummary[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.xAgent.provider.listProfiles().then((items) => {
      if (!cancelled) setProfiles(items.filter(isDeepSeekWebProvider));
    }).catch(() => {
      if (!cancelled) setError("读取供应商配置失败，请重新打开工具设置。");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Native capabilities come from Pi's authenticated runtime, including models without a GUI profile.
  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    void window.xAgent.session.listModels().then((items) => {
      if (!cancelled) setModels(items);
    }).catch(() => {
      if (!cancelled) {
        setModels([]);
        setError("读取模型信息失败，请重新打开工具设置。");
      }
    }).finally(() => {
      if (!cancelled) setModelsLoading(false);
    });
    return () => { cancelled = true; };
  }, [prefs.provider, prefs.model]);

  /** Persist explicit options and update the view only after the main-process save succeeds. */
  const saveOptions = async (patch: Partial<ClientPrefs>) => {
    setSaving(true);
    setError(null);
    try {
      const next = await window.xAgent.prefs.set(patch);
      onPrefsChanged?.(next);
    } catch {
      setError("保存 DeepSeek 设置失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  const selectedId = prefs.deepseekWebProviderId ?? "";
  const selected = profiles.find((profile) => profile.id === selectedId);
  const nativeReady = models.some((model) => model.provider === prefs.provider && model.id === prefs.model && model.deepseekChatbot === true);
  const ready = nativeReady || Boolean(selected?.enabled && hasKey(selected));
  const options = [
    { value: "", label: "选择供应商" },
    ...profiles.map((profile) => ({
      value: profile.id,
      label: `${profile.name}${!profile.enabled ? "（已停用）" : !hasKey(profile) ? "（缺少密钥）" : ""}`,
      disabled: !profile.enabled || !hasKey(profile),
    })),
    ...(selectedId && !selected ? [{ value: selectedId, label: "配置不可用", disabled: true }] : []),
  ];

  return (
    <div className="settings-block">
      <div className="settings-block-head">
        <h4 className="settings-block-title">DeepSeek 网络</h4>
        <button type="button" className="btn btn-ghost btn-sm settings-link-btn" onClick={onOpenProviders}>管理供应商</button>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">网络供应商</span>
        <SelectMenu aria-label="DeepSeek 网络供应商" value={selectedId} options={options}
          disabled={loading || saving} onChange={(id) => { void saveOptions({ deepseekWebProviderId: id || null }); }} />
      </div>
      <div className="tool-grid">
        {WEB_TOOLS.map((tool) => (
          <label key={tool} className="tool-check">
            <input type="checkbox" checked={prefs.tools.includes(tool)}
              disabled={loading || modelsLoading || saving || (!ready && !prefs.tools.includes(tool))}
              onChange={() => onToggleTool(tool)} />
            <span>{tool === "web_search" ? "网页搜索" : "链接阅读"}</span>
          </label>
        ))}
      </div>
      <div className="tool-grid">
        <label className="tool-check" title={nativeReady ? undefined : "仅支持官方 deepseek-flash"}>
          <input type="checkbox" checked={prefs.deepseekLatestReminder === true}
            disabled={modelsLoading || saving || !nativeReady}
            onChange={(event) => { void saveOptions({ deepseekLatestReminder: event.target.checked }); }} />
          <span>日期与语言信息</span>
        </label>
        <label className="tool-check" title={nativeReady ? undefined : "仅支持官方 deepseek-flash"}>
          <input type="checkbox" checked={prefs.deepseekSafetyCheck === true}
            disabled={modelsLoading || saving || !nativeReady}
            onChange={(event) => { void saveOptions({ deepseekSafetyCheck: event.target.checked }); }} />
          <span>内容安全审核</span>
        </label>
      </div>
      {error && <SettingsNotice text={error} tone="error" onDismiss={() => setError(null)} />}
    </div>
  );
}
