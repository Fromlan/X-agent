import {
  Brain,
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
  ModelInfo,
  ThinkingLevel,
} from "@shared/ipc";
import { StatusIcon } from "./StatusIcon";
import { SelectMenu } from "./SelectMenu";

interface Props {
  cwd: string | null;
  status: AgentStatus;
  models: ModelInfo[];
  currentModelKey: string;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  showThinking: boolean;
  theme: ColorMode;
  busy: boolean;
  rightPanelOpen: boolean;
  compacting?: boolean;
  updateStatus?: AppUpdateStatus | null;
  onOpenProject: () => void;
  onNewSession: () => void;
  onModelChange: (value: string) => void;
  onThinkingChange: (level: ThinkingLevel) => void;
  onToggleThinking: () => void;
  onToggleTheme: () => void;
  onToggleRightPanel: () => void;
  onOpenSettings: () => void;
  onOpenUpdateSettings?: () => void;
}

function statusLabel(status: AgentStatus): string {
  if (status === "streaming") return "运行中";
  if (status === "retrying") return "重试中";
  if (status === "error") return "错误";
  return "空闲";
}

export function TopBar(props: Props) {
  const modelOptions =
    props.models.length === 0
      ? [{ value: "", label: "无可用模型", disabled: true }]
      : props.models.map((m) => {
          const key = `${m.provider}/${m.id}`;
          return {
            value: key,
            label: `${m.name} (${m.provider})`,
          };
        });

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={props.onOpenProject}
          disabled={props.busy}
          title="打开项目"
        >
          <FolderOpen size={14} />
          <span className="btn-label">打开项目</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={props.onNewSession}
          disabled={
            props.busy ||
            props.compacting ||
            !props.cwd ||
            props.status === "streaming" ||
            props.status === "retrying"
          }
          title="新会话"
        >
          <MessageSquarePlus size={14} />
          <span className="btn-label">新会话</span>
        </button>
        <span className="cwd" title={props.cwd ?? ""}>
          {props.cwd ?? "未打开项目"}
        </span>
      </div>

      <div className="topbar-right">
        <div className="field" title="模型">
          <span className="field-label">模型</span>
          <SelectMenu
            variant="pill"
            value={props.currentModelKey}
            options={modelOptions}
            onChange={props.onModelChange}
            disabled={!props.cwd || props.models.length === 0 || props.busy}
            aria-label="模型"
            placeholder="选择模型"
          />
        </div>

        <div className="field" title="Thinking">
          <span className="field-label">Thinking</span>
          <SelectMenu
            variant="pill"
            className="select-menu-compact"
            value={props.thinkingLevel}
            options={props.thinkingLevels.map((level) => ({
              value: level,
              label: level,
            }))}
            onChange={(v) => props.onThinkingChange(v as ThinkingLevel)}
            disabled={!props.cwd || props.busy}
            aria-label="Thinking"
          />
        </div>

        <button
          type="button"
          className={`thinking-toggle${props.showThinking ? " is-on" : ""}`}
          onClick={props.onToggleThinking}
          title={props.showThinking ? "关闭展示思考" : "开启展示思考"}
          aria-pressed={props.showThinking}
          aria-label="切换展示思考"
        >
          <Brain size={14} strokeWidth={2} />
          <span className="thinking-toggle-label">展示思考</span>
          <span className="thinking-toggle-state" aria-hidden="true">
            {props.showThinking ? "开" : "关"}
          </span>
        </button>

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
            onClick={props.onOpenUpdateSettings ?? props.onOpenSettings}
            title={
              props.updateStatus.downloaded
                ? `已下载 ${props.updateStatus.version ?? "新版本"}，可安装`
                : `发现新版本 ${props.updateStatus.version ?? ""}`
            }
            aria-label="有可用更新"
          >
            <Download size={14} />
            <span className="btn-label">
              {props.updateStatus.downloaded
                ? "安装更新"
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

        <span className="status-chip" title={statusLabel(props.status)}>
          <StatusIcon status={props.status} />
          <span className="status-label">{statusLabel(props.status)}</span>
        </span>
      </div>
    </header>
  );
}
