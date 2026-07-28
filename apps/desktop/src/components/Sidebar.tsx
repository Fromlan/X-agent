import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { AgentStatus, SessionInfo } from "@shared/ipc";
import {
  filterVisibleProjectGroups,
  groupSessionsByProject,
  normalizeProjectKey,
} from "@/lib/group-sessions";
import { StatusIcon } from "./StatusIcon";

interface Props {
  sessions: SessionInfo[];
  hiddenProjectKeys: string[];
  activeSessionId: string | null;
  activeCwd: string | null;
  agentStatus: AgentStatus;
  busy: boolean;
  /** True while context compaction is in progress. */
  compacting?: boolean;
  onResume: (path: string) => void;
  onDelete: (path: string) => void;
  onHideProject: (cwd: string, label: string) => void;
  onRename: (path: string, name: string) => void | Promise<void>;
  onRefresh: () => void;
  onResizePointerDown?: (e: ReactPointerEvent) => void;
  onResizeDoubleClick?: () => void;
  resizing?: boolean;
}

export function Sidebar({
  sessions,
  hiddenProjectKeys,
  activeSessionId,
  activeCwd,
  agentStatus,
  busy,
  compacting = false,
  onResume,
  onDelete,
  onHideProject,
  onRename,
  onRefresh,
  onResizePointerDown,
  onResizeDoubleClick,
  resizing,
}: Props) {
  const locked =
    busy ||
    compacting ||
    agentStatus === "streaming" ||
    agentStatus === "retrying";
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(
    () =>
      filterVisibleProjectGroups(
        groupSessionsByProject(sessions),
        hiddenProjectKeys,
      ),
    [sessions, hiddenProjectKeys],
  );

  const keysToExpand = useMemo(() => {
    const keys = new Set<string>();
    if (activeCwd) keys.add(normalizeProjectKey(activeCwd));
    if (activeSessionId) {
      const match = sessions.find((s) => s.id === activeSessionId);
      if (match) keys.add(normalizeProjectKey(match.cwd));
    }
    return keys;
  }, [activeCwd, activeSessionId, sessions]);

  useEffect(() => {
    if (keysToExpand.size === 0) return;
    setCollapsed((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const key of keysToExpand) {
        if (next.has(key)) {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [keysToExpand]);

  useEffect(() => {
    if (editingPath) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingPath]);

  const startEdit = (s: SessionInfo) => {
    if (busy || renaming) return;
    setEditingPath(s.path);
    setDraftName(s.name);
  };

  const cancelEdit = () => {
    if (renaming) return;
    setEditingPath(null);
    setDraftName("");
  };

  const commitEdit = async (path: string) => {
    const next = draftName.trim();
    if (!next) {
      cancelEdit();
      return;
    }
    const current = sessions.find((s) => s.path === path);
    if (current && current.name === next) {
      cancelEdit();
      return;
    }
    setRenaming(true);
    try {
      await onRename(path, next);
      setEditingPath(null);
      setDraftName("");
    } finally {
      setRenaming(false);
    }
  };

  const onEditKeyDown = (e: KeyboardEvent<HTMLInputElement>, path: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitEdit(path);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const activeKey = activeCwd ? normalizeProjectKey(activeCwd) : "";

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h2>会话</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onRefresh}
          title="刷新"
        >
          <RefreshCw size={13} />
          刷新
        </button>
      </div>
      <ul className="session-list">
        {sessions.length === 0 && (
          <li className="session-empty">暂无会话记录</li>
        )}
        {groups.map((group) => {
          const expanded = !collapsed.has(group.key);
          const isActiveProject = group.key === activeKey && activeKey !== "";
          return (
            <li key={group.key || "__unknown__"} className="project-group">
              <div
                className={
                  isActiveProject
                    ? "project-group-header is-active-project"
                    : "project-group-header"
                }
              >
                <button
                  type="button"
                  className="project-group-toggle"
                  onClick={() => toggleGroup(group.key)}
                  title={group.cwd || "未知项目"}
                  aria-expanded={expanded}
                >
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="project-group-label">{group.label}</span>
                  <span className="project-group-count tabular">
                    {group.sessions.length}
                  </span>
                </button>
                {group.key !== "" && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon project-group-hide"
                    title="从侧栏移除"
                    disabled={busy || renaming}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        window.confirm(
                          `从侧栏移除「${group.label}」？\n会话文件不会删除，再次打开该项目后会重新出现。`,
                        )
                      ) {
                        onHideProject(group.cwd, group.label);
                      }
                    }}
                  >
                    <EyeOff size={12} />
                  </button>
                )}
              </div>
              {expanded && (
                <ul className="project-group-sessions">
                  {group.sessions.map((s) => {
                    const active = s.id === activeSessionId;
                    const editing = editingPath === s.path;
                    return (
                      <li key={s.path}>
                        <div
                          className={active ? "session-card active" : "session-card"}
                        >
                          {editing ? (
                            <div className="session-card-edit">
                              <StatusIcon status={active ? agentStatus : "idle"} />
                              <input
                                ref={inputRef}
                                className="session-rename-input"
                                value={draftName}
                                disabled={renaming}
                                onChange={(e) => setDraftName(e.target.value)}
                                onKeyDown={(e) => onEditKeyDown(e, s.path)}
                                onBlur={() => {
                                  window.setTimeout(() => {
                                    if (editingPath === s.path && !renaming) {
                                      void commitEdit(s.path);
                                    }
                                  }, 120);
                                }}
                                maxLength={80}
                                aria-label="会话标题"
                              />
                              <div className="session-card-actions">
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-icon"
                                  title="保存"
                                  disabled={renaming || !draftName.trim()}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => void commitEdit(s.path)}
                                >
                                  <Check size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-icon"
                                  title="取消"
                                  disabled={renaming}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={cancelEdit}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="session-card-main"
                                onClick={() => onResume(s.path)}
                                disabled={locked}
                                title={s.name}
                              >
                                <StatusIcon status={active ? agentStatus : "idle"} />
                                <div className="session-card-text">
                                  <div className="session-card-title">{s.name}</div>
                                  <div className="session-card-meta tabular">
                                    {new Date(s.updatedAt).toLocaleString()}
                                  </div>
                                </div>
                              </button>
                              <div className="session-card-actions">
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-icon"
                                  title="重命名"
                                  disabled={busy || renaming}
                                  onClick={() => startEdit(s)}
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-icon"
                                  title="删除"
                                  disabled={busy || renaming}
                                  onClick={() => {
                                    if (window.confirm(`删除会话「${s.name}」？`)) {
                                      onDelete(s.path);
                                    }
                                  }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {onResizePointerDown && (
        <div
          className={`column-resize-handle column-resize-handle--right${resizing ? " is-dragging" : ""}`}
          onPointerDown={onResizePointerDown}
          onDoubleClick={onResizeDoubleClick}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧栏宽度"
          title="拖动调整宽度 · 双击恢复默认"
        />
      )}
    </aside>
  );
}
