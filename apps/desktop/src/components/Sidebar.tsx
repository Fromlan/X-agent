import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import type { AgentStatus, SessionInfo } from "@shared/ipc";
import { StatusIcon } from "./StatusIcon";

interface Props {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  agentStatus: AgentStatus;
  busy: boolean;
  onResume: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (path: string, name: string) => void;
  onRefresh: () => void;
}

function shortPath(p: string): string {
  if (p.length <= 36) return p;
  return `…${p.slice(-34)}`;
}

function shortName(name: string): string {
  if (name.length <= 28) return name;
  return `${name.slice(0, 12)}…${name.slice(-10)}`;
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
          return (
            <li key={s.path}>
              <div className={active ? "session-card active" : "session-card"}>
                <button
                  type="button"
                  className="session-card-main"
                  onClick={() => onResume(s.path)}
                  disabled={locked}
                  title={s.path}
                >
                  <StatusIcon status={active ? agentStatus : "idle"} />
                  <div>
                    <div className="session-card-title">{shortName(s.name)}</div>
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
                    disabled={busy}
                    onClick={() => {
                      const next = window.prompt("会话名称", s.name);
                      if (next != null && next.trim()) onRename(s.path, next.trim());
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    title="删除"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`删除会话「${s.name}」？`)) {
                        onDelete(s.path);
                      }
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
