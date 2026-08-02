/**
 * PluginsPage —— 顶层薄壳:组合 toolbar / tabs / list / editor / packages / modal。
 * 业务状态与副作用全部在 `usePluginsState` 中,子组件只负责渲染。
 */
import { SettingsNotice, useAutoClearNotice } from "../SettingsNotice";
import { usePluginsState } from "./usePluginsState";
import type { PluginsState } from "./usePluginsState";
import { allSkillsEnabled } from "./PluginSkillToggle";
import { PluginsToolbar } from "./PluginsToolbar";
import { PluginsTabs } from "./PluginsTabs";
import { PluginList } from "./PluginList";
import { PluginEditor } from "./PluginEditor";
import { PluginPackagesPane } from "./PluginPackagesPane";
import { CreatePluginModal } from "./CreatePluginModal";
import type { ClientPrefs } from "@shared/ipc";

interface Props {
  cwd: string | null;
  prefs: ClientPrefs;
  hasActiveSession?: boolean;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
}

export function PluginsPage(props: Props) {
  const { cwd, prefs, onPrefsChanged } = props;
  const state = usePluginsState({
    cwd,
    prefs,
    hasActiveSession: props.hasActiveSession,
    onPrefsChanged,
  });

  useAutoClearNotice(state.message, () => state.dismissNotice(), 4500, !state.error);

  // 派生 allSkillsEnabled 用于 toolbar 按钮图标。
  // 子组件 (PluginSkillToggle) 已独立 derive,这里只用于一键按钮。
  const allOn = allSkillsEnabled(state, prefs);

  return (
    <div className="plugins-page plugins-page--embedded">
      <PluginsToolbar
        state={state}
        cwd={cwd}
        allSkillsEnabled={allOn}
        onNewClick={() => {
          state.setCreateScope(cwd ? "project" : "global");
          state.setCreateOpen(true);
        }}
      />
      <PluginsTabs
        kind={state.kind}
        setKind={state.setKind}
        scopeFilter={state.scopeFilter}
        setScopeFilter={state.setScopeFilter}
        isPackageTab={state.isPackageTab}
        cwd={cwd}
      />
      {(state.message || state.error) && (
        <SettingsNotice
          text={(state.error ?? state.message)!}
          tone={state.error ? "error" : "warn"}
          onDismiss={state.dismissNotice}
        />
      )}
      <div className="plugins-body">
        {state.isPackageTab ? (
          <PluginPackagesPane state={state} />
        ) : (
          <>
            <aside className="plugins-list-pane">
              <PluginList
                state={state}
                prefs={prefs}
                kind={state.kind}
                onOpen={state.openItem}
                onToggle={state.toggleSkill}
              />
            </aside>
            <section className="plugins-editor-pane">
              <PluginEditor state={state} prefs={prefs} />
            </section>
          </>
        )}
      </div>
      <footer className="plugins-footer">
        文档：pi.dev/docs/latest · 仓库 Pi插件指导文档.md
      </footer>
      <CreatePluginModal state={state} cwd={cwd} />
    </div>
  );
}