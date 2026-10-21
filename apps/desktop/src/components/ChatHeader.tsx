/** Show the active conversation and project identity without crowding the composer. */
import { FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import type { SessionType } from "@shared/session-type";
import { SESSION_TYPE_LABELS } from "@shared/session-type";
import { projectDisplayName } from "../lib/group-sessions";
import { godotConnectionLabel, isProjectGodotConnected, projectGodotConnection } from "../lib/godot-connection";
import type { GodotRpcStatusDto } from "@shared/ipc";

interface Props {
  cwd: string | null;
  title?: string;
  sessionType: SessionType;
  isGodotProject: boolean;
  rpcStatus: GodotRpcStatusDto | null;
  actions?: ReactNode;
}

/** Keep long project paths and conversation titles readable in narrow windows. */
export function ChatHeader({ cwd, title, sessionType, isGodotProject, rpcStatus, actions }: Props) {
  const connected = isProjectGodotConnected(cwd, rpcStatus);
  return (
    <header className="chat-header">
      <div className="chat-header-main">
        <h1 title={title}>{title || (cwd ? "新会话" : "开始新的创作")}</h1>
        <div className="chat-header-meta">
          <FolderOpen size={13} aria-hidden />
          <span className="chat-header-project" title={cwd ?? undefined}>
            {cwd ? projectDisplayName(cwd) : "打开一个项目，与 X-agent 一起构建"}
          </span>
          {cwd && <><span aria-hidden>/</span><span>{SESSION_TYPE_LABELS[sessionType]}会话</span></>}
        </div>
      </div>
      {isGodotProject && (
        <span className={`chat-header-connection${connected ? " is-connected" : ""}`} role="status" title={projectGodotConnection(cwd, rpcStatus)?.message}>
          <span aria-hidden />
          {godotConnectionLabel(cwd, rpcStatus)}
        </span>
      )}
      {actions}
    </header>
  );
}
