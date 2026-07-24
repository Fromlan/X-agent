import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import type { AgentStatus, SessionInfo } from "@shared/ipc";
import { StatusIcon } from "./StatusIcon";

interface Props {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  agentStatus: AgentStatus;
  busy: boolean;
  onResume: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (path: string, name: string) => void | Promise<void>;
  onRefresh: () => void;
}

function shortPath(p: string): string {
  if (p.length <= 36) return p;
  return `…${p.slice(-34)}`;
}

export function Sidebar({
  sessions,
  activeSessionId,
  agentStatus,
  busy,
  onResume,
  onDelete,
  onRename,
  onRefresh,
}: Props) {
  const locked = busy || agentStatus === "streaming" || agentStatus === "retrying";
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
        {sessions.map((s) => {
          const active = s.id === activeSessionId;
          const editing = editingPath === s.path;
          return (
            <li key={s.path}>
              <div className={active ? "session-card active" : "session-card"}>
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
                        // Delay so action buttons can receive the click first.
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
                        <div className="session-card-meta">
                          {shortPath(s.cwd || s.path)}
                        </div>
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
    </aside>
  );
}
