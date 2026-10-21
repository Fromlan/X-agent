/** Keep the project switcher and actions in the sidebar, matching the approved reference's hierarchy. */
import { Folder, FolderOpen, Plus, Settings } from "lucide-react";
import type { SessionType } from "@shared/ipc";
import { projectDisplayName, normalizeProjectKey } from "../../lib/group-sessions";
import { SelectMenu } from "../SelectMenu";
import type { SidebarState } from "./useSidebarState";

interface Props {
  state: SidebarState;
  cwd: string | null;
  isGodotProject: boolean;
  collapsed: boolean;
  busy: boolean;
  locked: boolean;
  selectedType: SessionType;
  onOpen: () => void;
  onNew: (type: SessionType) => void;
  onSettings: () => void;
  onResume: (path: string) => void;
}

/** Select existing projects through their newest session and keep new-session type explicit. */
export function SidebarWorkspace(props: Props) {
  const { state, cwd, collapsed, locked } = props;
  const activeKey = cwd ? normalizeProjectKey(cwd) : "";
  const options = state.groups.map((group) => ({ value: group.key, label: group.label }));
  if (cwd && !options.some((option) => option.value === activeKey)) options.unshift({ value: activeKey, label: projectDisplayName(cwd) });
  const activeGroup = state.groups.find((group) => group.key === activeKey);
  return (
    <div className="sidebar-workspace">
      <div className="sidebar-project cwd" title={cwd ?? ""} onContextMenu={(event) => {
        if (activeGroup) state.openProjectMenu(activeGroup, event);
      }}>
        <div className="sidebar-project-icon"><Folder size={22} aria-hidden /></div>
        {!collapsed && (
          <div className="sidebar-project-copy">
            <SelectMenu
              variant="block"
              className="sidebar-project-select"
              value={activeKey}
              options={options}
              placeholder="选择项目"
              aria-label="切换项目"
              title={cwd ?? "打开或切换项目"}
              disabled={locked || options.length === 0}
              onChange={(key) => {
                const session = state.groups.find((group) => group.key === key)?.sessions[0];
                if (session) props.onResume(session.path);
              }}
            />
            <span>{props.isGodotProject ? "Godot 4 项目" : cwd ? "项目工作区" : "尚未打开项目"}</span>
          </div>
        )}
      </div>
      <div className="sidebar-actions">
        <button type="button" className="btn btn-secondary" aria-label="打开项目" title="打开项目" disabled={props.busy} onClick={props.onOpen}>
          <FolderOpen size={15} aria-hidden />{!collapsed && <span>打开项目</span>}
        </button>
        <button type="button" className="btn btn-secondary" aria-label="新会话" title={props.selectedType === "design" ? "新策划会话" : "新代码会话"} disabled={locked || !cwd} data-session-type={props.selectedType} onClick={() => props.onNew(props.selectedType)}>
          <Plus size={16} aria-hidden />{!collapsed && <span>新会话</span>}
        </button>
        <button type="button" className="btn btn-secondary btn-icon" aria-label="项目设置" title="项目设置" onClick={props.onSettings}><Settings size={17} aria-hidden /></button>
      </div>
    </div>
  );
}
