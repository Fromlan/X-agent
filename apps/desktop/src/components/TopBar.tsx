import {
  Brain,
  FolderOpen,
  MessageSquarePlus,
  Moon,
  PanelRight,
  Settings2,
  Sun,
} from "lucide-react";
import type {
  AgentStatus,
  ColorMode,
  ModelInfo,
  ThinkingLevel,
} from "@shared/ipc";
import { StatusIcon } from "./StatusIcon";

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
  onOpenProject: () => void;
  onNewSession: () => void;
  onModelChange: (value: string) => void;
  onThinkingChange: (level: ThinkingLevel) => void;
  onToggleThinking: () => void;
  onToggleTheme: () => void;
  onToggleRightPanel: () => void;
  onOpenSettings: () => void;
}

function statusLabel(status: AgentStatus): string {
  if (status === "streaming") return "运行中";
  if (status === "retrying") return "重试中";
  if (status === "error") return "错误";
  return "空闲";
}

export function TopBar(props: Props) {
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
        <label className="field" title="模型">
          <span className="field-label">模型</span>
          <select
            value={props.currentModelKey}
            onChange={(e) => props.onModelChange(e.target.value)}
            disabled={!props.cwd || props.models.length === 0 || props.busy}
          >
            {props.models.length === 0 && <option value="">无可用模型</option>}
            {props.models.map((m) => {
              const key = `${m.provider}/${m.id}`;
              return (
                <option key={key} value={key}>
                  {m.name} ({m.provider})
                </option>
              );
            })}
          </select>
        </label>

        <label className="field" title="Thinking">
          <span className="field-label">Thinking</span>
          <select
            value={props.thinkingLevel}
            onChange={(e) =>
              props.onThinkingChange(e.target.value as ThinkingLevel)
            }
            disabled={!props.cwd || props.busy}
          >
            {props.thinkingLevels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={props.onToggleThinking}
          title={props.showThinking ? "隐藏思考" : "显示思考"}
        >
          <Brain size={14} />
          <span className="btn-label">
            {props.showThinking ? "隐藏思考" : "显示思考"}
          </span>
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={props.onOpenSettings}
          title="设置"
        >
          <Settings2 size={14} />
          <span className="btn-label">设置</span>
        </button>

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
