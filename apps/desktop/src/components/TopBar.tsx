import { memo } from "react";
import {
  Download,
  FolderOpen,
  MessageSquarePlus,
  Moon,
  PanelRight,
  Settings2,
  Sun,
} from "lucide-react";
import type {
  AgentStatus,
  AppUpdateStatus,
  ColorMode,
} from "@shared/ipc";

interface Props {
  cwd: string | null;
  status: AgentStatus;
  theme: ColorMode;
  busy: boolean;
  rightPanelOpen: boolean;
  compacting?: boolean;
  updateStatus?: AppUpdateStatus | null;
  updateActionBusy?: boolean;
  /** When true, mount --shadow-soft on the sticky bar (set by parent scroll listener). */
  elevated?: boolean;
  onOpenProject: () => void;
  onNewCodeSession: () => void;
  onNewDesignSession: () => void;
  onToggleTheme: () => void;
  onToggleRightPanel: () => void;
  onOpenSettings: () => void;
  /** Download / install, or re-show the update prompt after dismiss. */
  onUpdateAction?: () => void;
}

function TopBarImpl(props: Props) {
  return (
    <header
      className="topbar"
      data-elevated={props.elevated ? "true" : undefined}
    >
      <div className="topbar-left">
        <button
          type="button"
          className="btn btn-cta btn-sm"
          onClick={() => props.onOpenProject()}
          disabled={props.busy}
          title="打开项目"
        >
          <FolderOpen size={14} />
          <span className="btn-label">打开项目</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={props.onNewCodeSession}
          disabled={
            props.busy ||
            props.compacting ||
            !props.cwd ||
            props.status === "streaming" ||
            props.status === "retrying"
          }
          title="新代码会话（默认；写项目任意位置）"
          data-session-type="code"
        >
          <MessageSquarePlus size={14} />
          <span className="btn-label">新代码会话</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={props.onNewDesignSession}
          disabled={
            props.busy ||
            props.compacting ||
            !props.cwd ||
            props.status === "streaming" ||
            props.status === "retrying"
          }
          title="新策划会话（写只落到 game-design/）"
          data-session-type="design"
        >
          <MessageSquarePlus size={14} />
          <span className="btn-label">新策划会话</span>
        </button>
        <span className="cwd" title={props.cwd ?? ""}>
          {props.cwd ?? "未打开项目"}
        </span>
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={props.onOpenSettings}
          title="设置（Ctrl+,）"
        >
          <Settings2 size={14} />
          <span className="btn-label">设置</span>
        </button>

        {props.updateStatus?.available && (
          <button
            type="button"
            className="btn btn-secondary btn-sm topbar-update-badge"
            onClick={props.onUpdateAction ?? props.onOpenSettings}
            disabled={
              props.updateActionBusy || props.updateStatus.downloading
            }
            title={
              props.updateStatus.downloaded
                ? `已下载 ${props.updateStatus.version ?? "新版本"}，可安装`
                : props.updateStatus.downloading
                  ? `正在下载 ${props.updateStatus.version ?? "更新"}…`
                  : `发现新版本 ${props.updateStatus.version ?? ""}`
            }
            aria-label="有可用更新"
          >
            <Download size={14} />
            <span className="btn-label">
              {props.updateStatus.downloaded
                ? "安装更新"
                : props.updateStatus.downloading
                  ? "下载中…"
                  : props.updateStatus.version
                    ? `更新 ${props.updateStatus.version}`
                    : "有更新"}
            </span>
          </button>
        )}

        <button
          type="button"
          className={`btn btn-ghost btn-sm btn-icon${props.rightPanelOpen ? " is-active" : ""}`}
          onClick={props.onToggleRightPanel}
          title={props.rightPanelOpen ? "收起工具面板" : "打开工具面板"}
          aria-label="切换工具面板"
          aria-pressed={props.rightPanelOpen}
        >
          <PanelRight size={14} />
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={props.onToggleTheme}
          title={props.theme === "dark" ? "切换浅色" : "切换深色"}
          aria-label="切换主题"
        >
          {props.theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  );
}

// memo wrap: TopBar 只依赖会话外的状态（prefs / models / projectReadiness），
// items 流式更新不应触发 TopBar re-render。
export const TopBar = memo(TopBarImpl);
