import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  X,
} from "lucide-react";
import type { AgentStatus, SessionInfo } from "@shared/ipc";
import {
  filterVisibleProjectGroups,
  groupSessionsByProject,
  normalizeProjectKey,
} from "@/lib/group-sessions";
import { StatusIcon } from "./StatusIcon";
import { useConfirm } from "@/lib/app-confirm";

type ContextMenuState =
  | {
      kind: "session";
      x: number;
      y: number;
      session: SessionInfo;
    }
  | {
      kind: "project";
      x: number;
      y: number;
      key: string;
      cwd: string;
      label: string;
      sessionCount: number;
    };

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
  onDeleteProjectSessions: (cwd: string) => void;
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
  onDeleteProjectSessions,
  onHideProject,
  onRename,
  onRefresh,
  onResizePointerDown,
  onResizeDoubleClick,
  resizing,
}: Props) {
  const confirm = useConfirm();
  const locked =
    busy ||
    compacting ||
    agentStatus === "streaming" ||
    agentStatus === "retrying";
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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

  const closeMenu = useCallback(() => setMenu(null), []);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (x !== menu.x || y !== menu.y) {
      setMenu((m) => (m ? { ...m, x, y } : m));
    }
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    const onPointer = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    const onScroll = () => closeMenu();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    listRef.current?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      listRef.current?.removeEventListener("scroll", onScroll);
    };
  }, [menu, closeMenu]);

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

  const onEditKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>, path: string) => {
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

  const openSessionMenu = (s: SessionInfo, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy || renaming) return;
    setMenu({
      kind: "session",
      x: e.clientX,
      y: e.clientY,
      session: s,
    });
  };

  const openProjectMenu = (
    group: { key: string; cwd: string; label: string; sessions: SessionInfo[] },
    e: ReactMouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy || renaming) return;
    setMenu({
      kind: "project",
      x: e.clientX,
      y: e.clientY,
      key: group.key,
      cwd: group.cwd,
      label: group.label,
      sessionCount: group.sessions.length,
    });
  };

  const runSessionMenu = async (action: "rename" | "delete") => {
    if (!menu || menu.kind !== "session") return;
    const { session } = menu;
    closeMenu();
    if (action === "rename") {
      startEdit(session);
      return;
    }
    const ok = await confirm({
      title: "删除会话",
      message: `删除会话「${session.name}」？`,
      confirmLabel: "删除",
      tone: "danger",
    });
    if (ok) onDelete(session.path);
  };

  const runProjectMenu = async (action: "archive" | "deleteAll") => {
    if (!menu || menu.kind !== "project") return;
    const { key, cwd, label, sessionCount } = menu;
    closeMenu();
    if (action === "archive") {
      if (key === "") return;
      const ok = await confirm({
        title: "归档项目",
        message: `归档项目「${label}」？\n会话文件不会删除，再次打开该项目后会重新出现。`,
        confirmLabel: "归档",
        tone: "warn",
      });
      if (ok) onHideProject(cwd, label);
      return;
    }
    const ok = await confirm({
      title: "删除项目对话",
      message: `删除「${label}」下的全部 ${sessionCount} 个对话？\n此操作不可恢复。`,
      confirmLabel: "全部删除",
      tone: "danger",
    });
    if (ok) onDeleteProjectSessions(cwd);
  };

  const activeKey = activeCwd ? normalizeProjectKey(activeCwd) : "";
  const menuOpen = Boolean(menu);

  return (
    <aside className={`sidebar${menuOpen ? " is-context-menu-open" : ""}`}>
      <div className="sidebar-head">
        <h2>会话</h2>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onRefresh}
          title="刷新"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <ul className="session-list" ref={listRef}>
        {sessions.length === 0 && (
          <li className="session-empty">暂无会话记录</li>
        )}
        {groups.map((group) => {
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
                      <li key={s.path}>
                        <div
                          className={[
                            "session-card",
                            active ? "active" : "",
                            sessionMenuTarget ? "is-menu-target" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {editing ? (
                            <div className="session-card-edit">
                              <StatusIcon
                                status={active ? agentStatus : "idle"}
                              />
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
                            <button
                              type="button"
                              className="session-card-main"
                              onClick={() => onResume(s.path)}
                              onContextMenu={(e) => openSessionMenu(s, e)}
                              disabled={locked}
                              title={s.name}
                            >
                              <StatusIcon
                                status={active ? agentStatus : "idle"}
                              />
                              <div className="session-card-text">
                                <div className="session-card-title">
                                  {s.name}
                                </div>
                                <div className="session-card-meta tabular">
                                  {new Date(s.updatedAt).toLocaleString()}
                                </div>
                              </div>
                            </button>
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
      {menu && (
        <div
          ref={menuRef}
          className="rp-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          {menu.kind === "session" ? (
            <>
              <button
                type="button"
                className="rp-context-menu-item"
                role="menuitem"
                disabled={busy || renaming}
                onClick={() => runSessionMenu("rename")}
              >
                重命名
              </button>
              <div className="rp-context-menu-sep" />
              <button
                type="button"
                className="rp-context-menu-item is-danger"
                role="menuitem"
                disabled={busy || renaming || locked}
                onClick={() => runSessionMenu("delete")}
              >
                删除
              </button>
            </>
          ) : (
            <>
              {menu.key !== "" && (
                <>
                  <button
                    type="button"
                    className="rp-context-menu-item"
                    role="menuitem"
                    disabled={busy || renaming}
                    onClick={() => runProjectMenu("archive")}
                  >
                    归档项目
                  </button>
                  <div className="rp-context-menu-sep" />
                </>
              )}
              <button
                type="button"
                className="rp-context-menu-item is-danger"
                role="menuitem"
                disabled={busy || renaming || locked}
                onClick={() => runProjectMenu("deleteAll")}
              >
                删除全部对话
              </button>
            </>
          )}
        </div>
      )}
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
