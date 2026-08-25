import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { Check, X } from "lucide-react";
import type { AgentStatus, SessionInfo } from "@shared/ipc";
import { SESSION_TYPE_LABELS } from "@shared/session-type";
import { StatusIcon } from "../StatusIcon";

interface Props {
  session: SessionInfo;
  active: boolean;
  editing: boolean;
  sessionMenuTarget: boolean;
  agentStatus: AgentStatus;
  renaming: boolean;
  draftName: string;
  setDraftName: (v: string) => void;
  locked: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onCommit: () => void;
  onCancel: () => void;
  onResume: (path: string) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  onEditKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  onBlur: (e: ReactFocusEvent<HTMLInputElement>) => void;
}

export function SidebarItem({
  session,
  active,
  editing,
  sessionMenuTarget,
  agentStatus,
  renaming,
  draftName,
  setDraftName,
  locked,
  inputRef,
  onCommit,
  onCancel,
  onResume,
  onContextMenu,
  onEditKeyDown,
  onBlur,
}: Props) {
  return (
    <li>
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
            <StatusIcon status={active ? agentStatus : "idle"} />
            <input
              ref={inputRef}
              className="session-rename-input"
              value={draftName}
              disabled={renaming}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={onEditKeyDown}
              onBlur={onBlur}
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
                onClick={onCommit}
              >
                <Check size={12} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                title="取消"
                disabled={renaming}
                onMouseDown={(e) => e.preventDefault()}
                onClick={onCancel}
              >
                <X size={12} />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="session-card-main"
            onClick={() => onResume(session.path)}
            onContextMenu={onContextMenu}
            disabled={locked}
            title={session.name}
            data-session-type={session.sessionType}
          >
            <StatusIcon status={active ? agentStatus : "idle"} />
            <div className="session-card-text">
              <div className="session-card-title">{session.name}</div>
              <div className="session-card-meta tabular">
                {new Date(session.updatedAt).toLocaleString()}
              </div>
            </div>
            {session.sessionType === "design" && (
              <span
                className="session-type-badge"
                data-session-type="design"
                aria-label={`${SESSION_TYPE_LABELS.design} 会话`}
                title="策划会话（写只落到 game-design/）"
              >
                {SESSION_TYPE_LABELS.design}
              </span>
            )}
          </button>
        )}
      </div>
    </li>
  );
}