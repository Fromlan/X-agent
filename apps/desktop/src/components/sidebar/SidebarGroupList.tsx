import { ChevronDown, ChevronRight } from "lucide-react";
import type { SessionInfo } from "@shared/ipc";
import { SidebarItem } from "./SidebarItem";
import { StatusIcon } from "../StatusIcon";
import type { SidebarState } from "./useSidebarState";

interface Props {
  state: SidebarState;
  activeSessionId: string | null;
  agentStatus: import("@shared/ipc").AgentStatus;
  locked: boolean;
  onResume: (path: string) => void;
}

interface Group {
  key: string;
  cwd: string;
  label: string;
  sessions: SessionInfo[];
}

export function SidebarGroupList({
  state,
  activeSessionId,
  agentStatus,
  locked,
  onResume,
}: Props) {
  const {
    groups,
    collapsed,
    toggleGroup,
    editingPath,
    draftName,
    setDraftName,
    renaming,
    inputRef,
    menu,
    activeKey,
    openSessionMenu,
    openProjectMenu,
    commitEdit,
    cancelEdit,
    onEditKeyDown,
    listRef,
  } = state;

  if (groups.length === 0) {
    return (
      <ul className="session-list" ref={listRef}>
        <li className="session-empty">暂无会话记录</li>
      </ul>
    );
  }

  return (
    <ul className="session-list" ref={listRef}>
      {groups.map((group: Group) => {
        const expanded = !collapsed.has(group.key);
        const isActiveProject = group.key === activeKey && activeKey !== "";
        const projectMenuTarget =
          menu?.kind === "project" && menu.key === group.key;
        return (
          <li key={group.key || "__unknown__"} className="project-group">
            <div
              className={[
                "project-group-header",
                isActiveProject ? "is-active-project" : "",
                projectMenuTarget ? "is-menu-target" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onContextMenu={(e) => openProjectMenu(group, e)}
            >
              <button
                type="button"
                className="project-group-toggle"
                onClick={() => toggleGroup(group.key)}
                title={group.cwd || "未知项目"}
                aria-expanded={expanded}
              >
                {expanded ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )}
                <span className="project-group-label">{group.label}</span>
                <span className="project-group-count tabular">
                  {group.sessions.length}
                </span>
              </button>
            </div>
            {expanded && (
              <ul className="project-group-sessions">
                {group.sessions.map((s) => {
                  const active = s.id === activeSessionId;
                  const editing = editingPath === s.path;
                  const sessionMenuTarget =
                    menu?.kind === "session" && menu.session.path === s.path;
                  return (
                    <SidebarItem
                      key={s.path}
                      session={s}
                      active={active}
                      editing={editing}
                      sessionMenuTarget={Boolean(sessionMenuTarget)}
                      agentStatus={active ? agentStatus : "idle"}
                      renaming={renaming}
                      draftName={draftName}
                      setDraftName={setDraftName}
                      locked={locked}
                      inputRef={inputRef}
                      onCommit={() => void commitEdit(s.path)}
                      onCancel={cancelEdit}
                      onResume={onResume}
                      onContextMenu={(e) => openSessionMenu(s, e)}
                      onEditKeyDown={(e) => onEditKeyDown(e, s.path)}
                      onBlur={() => {
                        window.setTimeout(() => {
                          if (editingPath === s.path && !renaming) {
                            void commitEdit(s.path);
                          }
                        }, 120);
                      }}
                    />
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Re-export StatusIcon for useSidebarState consumers that need it.
export { StatusIcon };