/** Manage reusable editor installations separately from the current project's connection state. */
import { useEffect, useState } from "react";
import type { ClientPrefs, GodotEngineConfig, GodotEngineMutation } from "@shared/ipc";
import { normalizeProjectKey } from "@shared/project-path";
import { SelectMenu } from "../SelectMenu";
import { useConfirm } from "../../lib/app-confirm";
import { SettingsNotice } from "../SettingsNotice";

type Props = {
  prefs: ClientPrefs;
  cwd: string | null;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
};

/** Keep edits local until saved so typing never rewrites the preference store. */
function EngineRow({ engine, busy, onChange }: {
  engine: GodotEngineConfig;
  busy: boolean;
  onChange: (input: GodotEngineMutation) => Promise<void>;
}) {
  const [name, setName] = useState(engine.name);
  useEffect(() => setName(engine.name), [engine.name]);
  return <div className="godot-engine-row" aria-label={`引擎配置 ${engine.name}`}>
    <div className="settings-inline-row">
      <input className="input" aria-label={`引擎名称 ${engine.name}`} value={name} maxLength={120}
        disabled={busy} onChange={(event) => setName(event.target.value)} />
      {name.trim() !== engine.name && <button type="button" className="btn btn-secondary btn-sm"
        disabled={busy || !name.trim()} onClick={() => void onChange({ action: "rename", path: engine.path, name: name.trim() })}>保存名称</button>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
        aria-label={`移除引擎 ${engine.name}`} onClick={() => void onChange({ action: "remove", path: engine.path })}>移除</button>
    </div>
    <p className="godot-engine-version">{engine.version || "版本待检测"}</p>
    <p className="godot-engine-path" title={engine.path}>{engine.path}</p>
  </div>;
}

/** Apply one validated registry operation at a time and publish only persisted preferences. */
export function GodotEngineSettings({ prefs, cwd, onPrefsChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const confirm = useConfirm();
  const engines = prefs.godotEngines;
  const options = engines.map((engine) => ({ value: engine.path, label: `${engine.name}${engine.version ? ` · ${engine.version}` : ""}`, title: engine.path }));
  const projectEngine = cwd ? prefs.godotProjectEditors[normalizeProjectKey(cwd)] ?? "" : "";

  /** Resolve stored paths case-insensitively so migrated Windows choices remain selected. */
  const selection = (path: string | null | undefined): string => engines.find((engine) => normalizeProjectKey(engine.path) === normalizeProjectKey(path ?? ""))?.path ?? path ?? "";

  /** Surface cancellations quietly and retain the previous settings whenever persistence fails. */
  const changeEngine = async (input: GodotEngineMutation): Promise<void> => {
    if (busy) return;
    if (input.action === "remove") {
      const path = normalizeProjectKey(input.path);
      const projects = Object.values(prefs.godotProjectEditors).filter((value) => normalizeProjectKey(value) === path).length;
      const isDefault = normalizeProjectKey(prefs.godotEditorPath ?? "") === path;
      const affected = [isDefault ? "默认引擎" : "", projects ? `${projects} 个项目的引擎选择` : ""].filter(Boolean);
      if (affected.length && !await confirm({
        title: "移除已使用的引擎？", message: `${affected.join("和")}将恢复自动选择。引擎文件会保留。`,
        tone: "danger", confirmLabel: "移除引擎",
      })) return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await window.xAgent.godot.manageEngine(input);
      if (result.canceled) return;
      if (!result.ok || !result.prefs) throw new Error(result.error ?? "引擎配置保存失败");
      onPrefsChanged?.(result.prefs);
      setNotice({ text: input.action === "remove" ? "引擎配置已移除" : input.action === "project"
        ? "项目引擎已保存，下次打开编辑器时生效" : "引擎配置已保存" });
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), error: true }); }
    finally { setBusy(false); }
  };

  return <div className="settings-block">
    <div className="settings-block-head">
      <h4 className="settings-block-title">引擎管理</h4>
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
        onClick={() => void changeEngine({ action: "add" })}>{busy ? "正在保存…" : "添加引擎…"}</button>
    </div>
    {engines.length ? <div className="godot-engine-list">
      {engines.map((engine) => <EngineRow key={normalizeProjectKey(engine.path)} engine={engine} busy={busy} onChange={changeEngine} />)}
    </div> : <p className="modal-hint">添加已安装的 Godot 4 引擎，可为不同项目选择不同版本。</p>}
    <div className="field">
      <span>默认引擎</span>
      <SelectMenu variant="control" aria-label="默认 Godot 引擎" disabled={busy}
        value={selection(prefs.godotEditorPath)} options={[{ value: "", label: "自动检测" }, ...options]}
        onChange={(path) => void changeEngine({ action: "default", path: path || null })} />
    </div>
    {cwd && <div className="field">
      <span>当前项目引擎</span>
      <SelectMenu variant="control" aria-label="当前项目 Godot 引擎" disabled={busy}
        value={selection(projectEngine)} options={[{ value: "", label: "使用默认引擎 / 自动检测" }, ...options]}
        onChange={(path) => void changeEngine({ action: "project", projectPath: cwd, path: path || null })} />
    </div>}
    {notice && <SettingsNotice text={notice.text} tone={notice.error ? "error" : "neutral"} onDismiss={() => setNotice(null)} />}
  </div>;
}
