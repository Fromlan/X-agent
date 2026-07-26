import {
  Brain,
  FolderOpen,
  MessageSquarePlus,
  Moon,
  PanelRight,
  Settings2,
  Sun,
} from "lucide-react";
import type { AgentStatus, ModelInfo, ThinkingLevel } from "@shared/ipc";
import { StatusIcon } from "./StatusIcon";

interface Props {
  cwd: string | null;
  status: AgentStatus;
  models: ModelInfo[];
  currentModelKey: string;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  showThinking: boolean;
  theme: "light" | "dark";
  busy: boolean;
  rightPanelOpen: boolean;
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
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          X
        </span>
        <div>
          <div className="brand-title">X-agent</div>
          <div className="brand-sub">Pi Agent 客户端</div>
        </div>
      </div>

      <div className="topbar-center">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={props.onOpenProject}
          disabled={props.busy}
        >
          <FolderOpen size={14} />
          打开项目
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={props.onNewSession}
          disabled={
            props.busy ||
            !props.cwd ||
            props.status === "streaming" ||
            props.status === "retrying"
          }
        >
          <MessageSquarePlus size={14} />
          新会话
        </button>
        <span className="cwd" title={props.cwd ?? ""}>
          {props.cwd ?? "未打开项目"}
        </span>
      </div>

      <div className="topbar-right">
        <label className="field">
          模型
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

        <label className="field">
          Thinking
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
          {props.showThinking ? "隐藏思考" : "显示思考"}
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={props.onOpenSettings}
          title="设置"
        >
          <Settings2 size={14} />
          设置
        </button>

        <button
          type="button"
          className={`btn btn-ghost btn-sm${props.rightPanelOpen ? " is-active" : ""}`}
          onClick={props.onToggleRightPanel}
          title={props.rightPanelOpen ? "收起工具面板" : "打开工具面板"}
          aria-label="切换工具面板"
          aria-pressed={props.rightPanelOpen}
        >
          <PanelRight size={14} />
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={props.onToggleTheme}
          title={props.theme === "dark" ? "切换浅色" : "切换深色"}
          aria-label="切换主题"
        >
          {props.theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        <span className="status-chip">
          <StatusIcon status={props.status} />
          {statusLabel(props.status)}
        </span>
      </div>
    </header>
  );
}
