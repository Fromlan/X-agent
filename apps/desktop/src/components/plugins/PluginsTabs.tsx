import { Puzzle } from "lucide-react";
import { KIND_TABS, type PageKind, type ScopeFilter } from "./types";

interface Props {
  kind: PageKind;
  setKind: (k: PageKind) => void;
  scopeFilter: ScopeFilter;
  setScopeFilter: (s: ScopeFilter) => void;
  isPackageTab: boolean;
  cwd: string | null;
}

export function PluginsTabs({
  kind,
  setKind,
  scopeFilter,
  setScopeFilter,
  isPackageTab,
  cwd,
}: Props) {
  return (
    <div className="plugins-tabs">
      {KIND_TABS.map((tab) => (
        <button
          key={tab.kind}
          type="button"
          className={`plugins-tab${kind === tab.kind ? " active" : ""}`}
          onClick={() => setKind(tab.kind)}
        >
          <Puzzle size={13} style={{ marginRight: 4 }} />
          {tab.label}
        </button>
      ))}
      {!isPackageTab && (
        <div className="plugins-scope">
          <button
            type="button"
            className={scopeFilter === "all" ? "active" : ""}
            onClick={() => setScopeFilter("all")}
          >
            全部
          </button>
          <button
            type="button"
            className={scopeFilter === "global" ? "active" : ""}
            onClick={() => setScopeFilter("global")}
          >
            全局
          </button>
          <button
            type="button"
            className={scopeFilter === "project" ? "active" : ""}
            onClick={() => setScopeFilter("project")}
            disabled={!cwd}
          >
            项目
          </button>
        </div>
      )}
    </div>
  );
}