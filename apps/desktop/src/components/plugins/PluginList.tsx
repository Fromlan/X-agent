import type { ClientPrefs, PluginKind } from "@shared/ipc";
import { isSkillEnabled } from "./PluginSkillToggle";
import { kindLabel, type PageKind } from "./types";
import type { PluginsState } from "./usePluginsState";

interface Props {
  state: PluginsState;
  prefs: ClientPrefs;
  kind: PageKind;
  onOpen: (item: PluginsState["items"][number]) => void;
  onToggle: (skillId: string, enabled: boolean) => void;
}

export function PluginList({ state, prefs, kind, onOpen, onToggle }: Props) {
  const { filtered, isSkillTab, busy, packages, selectedPath } = state;
  if (filtered.length === 0) {
    return (
      <p className="empty-state">
        暂无{kindLabel(kind as PluginKind)}插件。
        {packages.length > 0 && kind !== "theme"
          ? " 若刚安装了 Package，点「刷新」；包内资源会标 Package。"
          : null}
      </p>
    );
  }
  return (
    <div className="plugins-list">
      {filtered.map((item) => {
        const skillOn = isSkillTab ? isSkillEnabled(prefs, item.name) : true;
        return (
          <div
            key={`${item.id}:${item.path}`}
            role="button"
            tabIndex={0}
            className={`plugin-item${selectedPath === item.path ? " active" : ""}${
              isSkillTab && !skillOn ? " plugin-item--disabled" : ""
            }`}
            onClick={() => onOpen(item)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(item);
              }
            }}
          >
            {isSkillTab && (
              <span
                className="plugin-item-toggle"
                title={skillOn ? "关闭技能" : "启用技能"}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={skillOn}
                  disabled={busy}
                  aria-label={
                    skillOn
                      ? `关闭技能 ${item.name}`
                      : `启用技能 ${item.name}`
                  }
                  onChange={() => {
                    void onToggle(item.name, !skillOn);
                  }}
                />
              </span>
            )}
            <div className="plugin-item-body">
              <div className="plugin-item-title">{item.name}</div>
              <div className="plugin-item-meta">
                {item.packageName
                  ? `Package · ${item.packageName}`
                  : item.scope === "global"
                    ? "全局"
                    : "项目"}
                {isSkillTab && !skillOn
                  ? " · 已关闭"
                  : item.description && !item.packageName
                    ? ` · ${item.description}`
                    : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}