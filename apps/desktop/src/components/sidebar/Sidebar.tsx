/**
 * Sidebar 顶层壳 —— 组合 head / group list / context menu / resize handle。
 * 业务状态由 `useSidebarState` 提供,子组件只渲染。
 */
import { memo } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { RefreshCw } from "lucide-react";
import type { AgentStatus, SessionInfo } from "@shared/ipc";
import { useSidebarState } from "./useSidebarState";
import { SidebarGroupList } from "./SidebarGroupList";
import { SidebarItemMenu } from "./SidebarItemMenu";

interface Props {
  sessions: SessionInfo[];
  hiddenProjectKeys: string[];
  activeSessionId: string | null;
  activeCwd: string | null;
  agentStatus: AgentStatus;
  busy: boolean;
  /** True while context compaction is in progress. */
  compacting?: boolean;
  /** True while `listSessions` is in flight; surfaces skeleton in the list. */
  sessionsLoading?: boolean;
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

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "空闲",
  streaming: "运行中",
  retrying: "重试中",
  error: "出错",
};

function projectLabel(cwd: string | null): string {
  if (!cwd) return "未打开项目";
  // 与 SidebarGroupList 内 group label 保持一致：取路径末段
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function SidebarImpl({
  sessions,
  hiddenProjectKeys,
  activeSessionId,
  activeCwd,
  agentStatus,
  busy,
  compacting = false,
  sessionsLoading = false,
  onResume,
  onDelete,
  onDeleteProjectSessions,
  onHideProject,
  onRename,
  onRefresh,
  onResizePointerDown,
  onResizeDoubleClick,
  resizing = false,
}: Props) {
  const state = useSidebarState({
    sessions,
    hiddenProjectKeys,
    activeSessionId,
    activeCwd,
    busy,
    onDelete,
    onDeleteProjectSessions,
    onHideProject,
    onRename,
  });
  const locked =
    busy ||
    compacting ||
    agentStatus === "streaming" ||
    agentStatus === "retrying";

  const statusClass = compacting
    ? "compacting"
    : agentStatus === "error"
      ? "error"
      : agentStatus === "retrying"
        ? "retrying"
        : agentStatus === "streaming"
          ? "streaming"
          : "idle";
  const statusText = compacting
    ? "压缩中"
    : STATUS_LABEL[agentStatus] ?? "空闲";

  return (
    <aside className={`sidebar${state.menuOpen ? " is-context-menu-open" : ""}`}>
      <div className="sidebar-head">
        <div className="sidebar-head-info">
          <span className="sidebar-head-kicker">项目</span>
          <span
            className={`sidebar-head-project status-${statusClass}`}
            title={activeCwd ?? "未打开项目"}
          >
            <span className="sidebar-head-dot" aria-hidden />
            <span className="sidebar-head-name">{projectLabel(activeCwd)}</span>
            <span className="sidebar-head-status">{statusText}</span>
          </span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onRefresh}
          title="刷新"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <SidebarGroupList
        state={state}
        activeSessionId={activeSessionId}
        agentStatus={agentStatus}
        locked={locked}
        loading={sessionsLoading}
        onResume={onResume}
      />
      <SidebarItemMenu state={state} busy={busy} locked={locked} renaming={false} />
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

/** Sidebar 顶层 memo 包装,屏蔽父级 App state 变化引发的子树重渲染。 */
export const Sidebar = memo(SidebarImpl);
