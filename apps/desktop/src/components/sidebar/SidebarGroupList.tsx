import { ChevronDown, ChevronRight } from "lucide-react";
import type { SessionInfo } from "@shared/ipc";
import { SidebarItem } from "./SidebarItem";
import type { SidebarState } from "./useSidebarState";

interface Props {
  state: SidebarState;
  activeSessionId: string | null;
  agentStatus: import("@shared/ipc").AgentStatus;
  locked: boolean;
  /** True while `listSessions` is in flight; renders skeleton rows. */
  loading?: boolean;
  /** Sidebar collapsed to icon-only mode. */
  collapsed?: boolean;
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
  loading = false,
  collapsed: sidebarCollapsed = false,
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
    if (sidebarCollapsed) {
      return (
        <ul className="session-list session-list-collapsed" ref={listRef}>
          <li className="session-empty-collapsed" aria-label="暂无会话">
            —
          </li>
        </ul>
      );
    }
    return (
      <ul className="session-list" ref={listRef}>
        {loading ? (
          <li className="session-skeleton" aria-busy="true" aria-label="加载会话列表">
            <span className="session-skeleton-row" aria-hidden />
            <span className="session-skeleton-row is-short" aria-hidden />
            <span className="session-skeleton-row" aria-hidden />
            <span className="session-skeleton-row is-short" aria-hidden />
          </li>
        ) : (
          <li className="session-empty">暂无会话记录</li>
        )}
      </ul>
    );
  }

  if (sidebarCollapsed) {
    return (
      <ul className="session-list session-list-collapsed" ref={listRef}>
        {groups.map((group: Group) => {
          const isActiveProject = group.key === activeKey && activeKey !== "";
          const initial = (group.label || "?").trim().charAt(0).toUpperCase();
          // 折叠态下点 project bubble：展开并跳到该项目最近一个 session
          const target = group.sessions[0];
          return (
            <li key={group.key || "__unknown__"} className="project-group-collapsed">
              <button
                type="button"
                className={`project-avatar${isActiveProject ? " is-active" : ""}`}
                title={`${group.label} · ${group.sessions.length} 个会话`}
                aria-label={`${group.label} · ${group.sessions.length} 个会话`}
                disabled={!target || locked}
                onClick={() => {
                  if (target) onResume(target.path);
                }}
              >
                <span aria-hidden>{initial}</span>
                {group.sessions.length > 1 && (
                  <span className="project-avatar-count tabular" aria-hidden>
                    {group.sessions.length}
                  </span>
                )}
              </button>
            </li>
          );
        })}
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
                      onBlur={(e) => {
                        // 焦点移到列表内（如点击其他会话项）会触发 onResume 切换，
                        // 此处跳过提交避免 120ms 后提交过期编辑；焦点离开列表才提交。
                        const t = e.relatedTarget as HTMLElement | null;
                        if (t && t.closest(".session-list")) return;
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