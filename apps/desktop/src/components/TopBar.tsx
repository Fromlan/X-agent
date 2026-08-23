import { memo } from "react";
import {
  Bot,
  Brain,
  ClipboardList,
  Download,
  Flag,
  FolderOpen,
  Hammer,
  MessageSquarePlus,
  Moon,
  PanelRight,
  Search,
  Settings2,
  Sun,
  Target,
} from "lucide-react";
import type {
  AgentSessionMode,
  AgentStatus,
  AppUpdateStatus,
  ColorMode,
  ModelInfo,
  ThinkingLevel,
} from "@shared/ipc";
import { SelectMenu } from "./SelectMenu";

interface Props {
  cwd: string | null;
  status: AgentStatus;
  theme: ColorMode;
  busy: boolean;
  rightPanelOpen: boolean;
  compacting?: boolean;
  updateStatus?: AppUpdateStatus | null;
  updateActionBusy?: boolean;
  onOpenProject: () => void;
  onNewSession: () => void;
  onToggleTheme: () => void;
  onToggleRightPanel: () => void;
  onOpenSettings: () => void;
  /** Download / install, or re-show the update prompt after dismiss. */
  onUpdateAction?: () => void;
  // —— 新增：会话级控制（项目-会话线 与 控制线 拆开） ——
  /** 当前会话模式（active pill 决定视觉） */
  sessionMode: AgentSessionMode;
  /** 模式切换是否禁用（streaming / 无 cwd / editing） */
  modeSwitchDisabled: boolean;
  onSessionModeChange: (mode: AgentSessionMode) => void;
  /** 计划模式下「执行计划」按钮出现；可空表示无计划路径 */
  planPath?: string | null;
  onBuildPlan?: () => void;
  /** 模型 / Thinking / 展示思考 */
  models: ModelInfo[];
  currentModelKey: string;
  onModelChange: (value: string) => void;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  onThinkingChange: (level: ThinkingLevel) => void;
  showThinking: boolean;
  onToggleThinking: () => void;
}

const MODE_LABELS: Record<
  AgentSessionMode,
  { label: string; icon: typeof Bot; title: string }
> = {
  agent: {
    label: "智能体",
    icon: Bot,
    title: "执行任务并修改文件",
  },
  ask: {
    label: "调研",
    icon: Search,
    title: "只读研究与问答，不改文件",
  },
  plan: {
    label: "计划",
    icon: ClipboardList,
    title: "只读研究并写出计划",
  },
  goal: {
    label: "目标",
    icon: Target,
    title: "设定完成条件并自动续轮",
  },
};

const MODE_ORDER: AgentSessionMode[] = ["agent", "ask", "plan", "goal"];

function capitalizeLabel(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function TopBarImpl(props: Props) {
  const streaming =
    props.status === "streaming" || props.status === "retrying";
  const newSessionDisabled =
    props.busy ||
    props.compacting ||
    !props.cwd ||
    props.status === "streaming" ||
    props.status === "retrying";

  const modelOptions =
    props.models.length === 0
      ? [{ value: "", label: "无可用模型", disabled: true }]
      : props.models.map((m) => ({
          value: `${m.provider}/${m.id}`,
          label: m.name?.trim() || m.id,
        }));
  const modelDisabled = !props.cwd || streaming || props.models.length === 0;
  const thinkingOptions = props.thinkingLevels.map((level) => ({
    value: level,
    label: capitalizeLabel(level),
  }));
  const thinkingDisabled = !props.cwd || streaming;
  const showBuildPlan =
    props.sessionMode === "plan" && Boolean(props.planPath) && !streaming;

  return (
    <header className="topbar">
      {/* —— 项目-会话线：cwd 容器 — 允许收缩截断 — 始终可见 — */}
      <div className="topbar-region topbar-region--project">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
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
          onClick={props.onNewSession}
          disabled={newSessionDisabled}
          title="新会话"
        >
          <MessageSquarePlus size={14} />
          <span className="btn-label">新会话</span>
        </button>
        <span className="cwd" title={props.cwd ?? ""}>
          {props.cwd ?? "未打开项目"}
        </span>
      </div>

      {/* —— 会话控制线：模式 pill + 可选「执行计划」 — 视觉上把会话级控件与项目控件分开 — */}
      <div className="topbar-region topbar-region--session">
        <div className="topbar-mode-group" role="group" aria-label="会话模式">
          {MODE_ORDER.map((mode) => {
            const meta = MODE_LABELS[mode];
            const Icon = meta.icon;
            const active = props.sessionMode === mode;
            return (
              <button
                key={mode}
                type="button"
                className={`topbar-mode-pill${active ? " is-active" : ""}`}
                data-mode={mode}
                aria-pressed={active}
                disabled={
                  props.modeSwitchDisabled || !props.onSessionModeChange
                }
                onClick={() => props.onSessionModeChange?.(mode)}
                title={meta.title}
              >
                <Icon size={13} strokeWidth={2} aria-hidden />
                <span className="topbar-mode-pill-text">{meta.label}</span>
              </button>
            );
          })}
        </div>
        {showBuildPlan && (
          <button
            type="button"
            className="btn btn-secondary btn-sm topbar-build-plan"
            onClick={props.onBuildPlan}
            disabled={!props.onBuildPlan}
            title={props.planPath ?? undefined}
          >
            <Hammer size={14} />
            <span className="btn-label">执行计划</span>
          </button>
        )}
        {props.sessionMode === "goal" && (
          <span
            className="topbar-goal-flag"
            title="目标模式：自动续轮直到完成条件"
          >
            <Flag size={12} aria-hidden />
            目标
          </span>
        )}
      </div>

      {/* —— 应用线：模型/思考/右栏/主题/设置 — 永远在最右 — */}
      <div className="topbar-region topbar-region--app">
        <div className="field topbar-field" title="模型">
          <span className="field-label">模型</span>
          <SelectMenu
            variant="pill"
            className="select-menu-compact"
            value={props.currentModelKey}
            options={modelOptions}
            onChange={props.onModelChange}
            disabled={modelDisabled}
            aria-label="模型"
            placeholder="选择模型"
          />
        </div>
        <div className="field topbar-field" title="Thinking">
          <span className="field-label">Thinking</span>
          <SelectMenu
            variant="pill"
            className="select-menu-compact"
            value={props.thinkingLevel}
            options={thinkingOptions}
            onChange={(v) => props.onThinkingChange(v as ThinkingLevel)}
            disabled={thinkingDisabled}
            aria-label="Thinking"
          />
        </div>
        <button
          type="button"
          className={`thinking-toggle topbar-think-toggle${
            props.showThinking ? " is-on" : ""
          }`}
          onClick={props.onToggleThinking}
          title={props.showThinking ? "关闭展示思考" : "开启展示思考"}
          aria-pressed={props.showThinking}
          aria-label="切换展示思考"
        >
          <Brain size={13} strokeWidth={2} />
          <span className="thinking-toggle-label">展示思考</span>
          <span className="thinking-toggle-state" aria-hidden="true">
            {props.showThinking ? "开" : "关"}
          </span>
        </button>

        <span className="topbar-divider" aria-hidden />

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
