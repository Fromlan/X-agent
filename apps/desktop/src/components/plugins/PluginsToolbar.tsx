import { FilePlus2, RefreshCw } from "lucide-react";
import { PluginSkillToggle } from "./PluginSkillToggle";
import type { PluginsState } from "./usePluginsState";

interface Props {
  state: PluginsState;
  allSkillsEnabled: boolean;
  onNewClick: () => void;
}

export function PluginsToolbar({
  state,
  allSkillsEnabled,
  onNewClick,
}: Props) {
  const { busy, refresh, isPackageTab } = state;
  return (
    <header className="plugins-toolbar">
      <div className="plugins-title">
        <span>Pi 插件</span>
      </div>
      <div className="plugins-toolbar-right">
        <PluginSkillToggle
          state={state}
          allSkillsEnabled={allSkillsEnabled}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          刷新
        </button>
        {!isPackageTab && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={onNewClick}
          >
            <FilePlus2 size={14} />
            新建
          </button>
        )}
      </div>
    </header>
  );
}