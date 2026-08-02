import { FolderOpen, Save, Trash2 } from "lucide-react";
import type { ClientPrefs } from "@shared/ipc";
import { isSkillEnabled } from "./PluginSkillToggle";
import type { PluginsState } from "./usePluginsState";

interface Props {
  state: PluginsState;
  prefs: ClientPrefs;
}

export function PluginEditor({ state, prefs }: Props) {
  const {
    selected,
    content,
    setContent,
    dirty,
    warnings,
    isSkillTab,
    save,
    remove,
    busy,
  } = state;

  if (!selected) {
    return <p className="empty-state">选择左侧插件进行编辑</p>;
  }

  const skillOn = isSkillEnabled(prefs, selected.name);

  return (
    <>
      <div className="plugins-editor-meta">
        <div className="plugins-editor-meta-text">
          <h2>{selected.name}</h2>
          <p className="plugins-editor-path" title={selected.path}>
            {selected.path}
          </p>
        </div>
        <div className="plugins-editor-actions">
          {isSkillTab && (
            <label className="plugin-skill-enable">
              <input
                type="checkbox"
                checked={skillOn}
                disabled={busy}
                onChange={() => {
                  void state.toggleSkill(selected.name, !skillOn);
                }}
              />
              <span>启用</span>
            </label>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void window.xAgent.revealPlugin(selected.path)}
          >
            <FolderOpen size={13} />
            打开位置
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy || !selected.editable}
            title={
              selected.editable
                ? "删除"
                : "来自 Package，请在 Packages 中卸载"
            }
            onClick={() => void remove()}
          >
            <Trash2 size={13} />
            删除
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !dirty || !selected.editable}
            title={selected.editable ? "保存" : "来自 Package，只读预览"}
            onClick={() => void save()}
          >
            <Save size={13} />
            保存
          </button>
        </div>
      </div>
      {isSkillTab && !skillOn && (
        <div className="banner warn">
          已关闭：此技能不会出现在会话技能索引与 /skill 菜单中。
        </div>
      )}
      {!selected.editable && (
        <div className="banner warn">
          只读：来自已安装 Package
          {selected.packageName ? `（${selected.packageName}）` : ""}。
          {isSkillTab && !skillOn
            ? "已关闭时不会进入会话索引；卸载请到本页 Packages。"
            : "Agent 会加载这些资源；卸载请到本页 Packages 进行。"}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="banner warn">校验警告：{warnings.join("；")}</div>
      )}
      <textarea
        className="plugins-editor"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        readOnly={!selected.editable}
      />
    </>
  );
}