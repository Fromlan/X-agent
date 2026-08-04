import type {
  AgentSessionMode,
  AgentStatus,
  GoalInfo,
  SessionSlashItem,
} from "@shared/ipc";
import { isRestorableGoalStatus } from "@shared/ipc";
import type { ChatItem } from "../stores/chat-store";
import { ChatTranscript } from "./ChatTranscript";
import { SlashMenu } from "./SlashMenu";
import { AtMenu } from "./AtMenu";
import { Bot, ClipboardList, Flag, Hammer, Search, Send, Square, Target } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useSlashMenu } from "../hooks/useSlashMenu";
import { useAtCompletion } from "../hooks/useAtCompletion";

interface Props {
  items: ChatItem[];
  showThinking: boolean;
  status: AgentStatus;
  /** Live API status for the line above the textarea (null when idle). */
  apiStatus?: { phase: "thinking" | "receiving" | "retrying"; waitedMs?: number } | null;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onAbort: () => void;
  disabled: boolean;
  /** Bump after reloadResources so slash menu cache refreshes. */
  skillsRefreshKey?: string | number;
  queuedSteering?: string[];
  forceFollowKey?: string;
  onOpenToolInPanel?: (toolId: string, args: unknown) => void;
  editingEntryId?: string | null;
  editDraft?: string;
  onEditDraftChange?: (text: string) => void;
  onStartEdit?: (entryId: string, text: string) => void;
  onCancelEdit?: () => void;
  onConfirmEdit?: () => void;
  onRetract?: (entryId: string) => void;
  onRegenerate?: (userEntryId: string) => void;
  starters?: { id: string; label: string; prompt: string }[];
  readinessHints?: { label: string; onClick: () => void }[];
  onPickStarter?: (prompt: string) => void;
  sessionMode?: AgentSessionMode;
  planPath?: string | null;
  goal?: GoalInfo | null;
  onSessionModeChange?: (mode: AgentSessionMode) => void;
  onBuildPlan?: () => void;
  onClearGoal?: () => void;
  onPauseGoal?: () => void;
  onResumeGoal?: () => void;
  /** Cycle Agent → 调研 → Plan → 目标 (Shift+Tab). */
  onCycleSessionMode?: () => void;
  onClarifySelect?: (reply: string) => void;
}

/** Render an "已等待 12s" suffix when the wait exceeds 3 seconds. */
function formatWait(waitedMs?: number): string {
  if (typeof waitedMs !== "number" || waitedMs < 3000) return "";
  const sec = Math.round(waitedMs / 1000);
  return `（已等待 ${sec}s）`;
}

function ChatPanelImpl(props: Props) {
  const streaming =
    props.status === "streaming" || props.status === "retrying";
  const composerLocked = props.disabled || Boolean(props.editingEntryId);
  const sessionMode = props.sessionMode ?? "agent";
  const modeSwitchDisabled = composerLocked || streaming;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);

  const {
    slashMatch,
    menuOpen,
    filtered,
    highlight,
    setHighlight,
    selectSlashItem,
    dismissMenu,
    resetDismiss,
  } = useSlashMenu({
    input: props.input,
    cursor,
    disabled: composerLocked,
    skillsRefreshKey: props.skillsRefreshKey,
    textareaRef,
    setInput: props.setInput,
  });

  // 1.6 @-补全 —— 复用现有 slash 列表作为 skill 候选；path 候选待 file-tree IPC 接入
  const atSkillCandidates = useMemo(
    () =>
      filtered
        .filter((it) => it.source === "skill")
        .map((it) => ({ name: it.name, description: it.description })),
    [filtered],
  );
  const {
    match: atMatch,
    menuOpen: atMenuOpen,
    candidates: atCandidates,
    highlight: atHighlight,
    setHighlight: setAtHighlight,
    selectCandidate: selectAtCandidate,
    dismissMenu: dismissAtMenu,
  } = useAtCompletion({
    input: props.input,
    cursor,
    disabled: composerLocked,
    pathCandidates: [],
    skillCandidates: atSkillCandidates,
    textareaRef,
    setInput: props.setInput,
  });

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    props.setInput(e.target.value);
    setCursor(e.target.selectionStart);
    resetDismiss();
  };

  const syncCursor = () => {
    const el = textareaRef.current;
    if (el) setCursor(el.selectionStart);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 1.6 @-补全菜单优先于 slash 菜单（@ 不会出现在 / 菜单中，但 / 菜单逻辑会先执行时可能误判）
    if (atMenuOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismissAtMenu();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (atCandidates.length === 0) return;
        setAtHighlight((i) => (i + 1) % atCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (atCandidates.length === 0) return;
        setAtHighlight((i) => (i - 1 + atCandidates.length) % atCandidates.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const candidate = atCandidates[atHighlight] ?? atCandidates[0];
        if (candidate) selectAtCandidate(candidate);
        return;
      }
    }
    if (menuOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismissMenu();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filtered.length === 0) return;
        setHighlight((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filtered.length === 0) return;
        setHighlight((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const item = filtered[highlight] ?? filtered[0];
        if (item) selectSlashItem(item);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (props.input.trim()) props.onSend();
    }
  };

  const goalVisible =
    props.goal != null && isRestorableGoalStatus(props.goal.status);
  const goalActive = props.goal?.status === "pursuing";
  const goalPaused =
    props.goal?.status === "paused" ||
    props.goal?.status === "budget_limited";

  // 切入目标模式时聚焦输入框，便于直接写完成条件
  useEffect(() => {
    if (sessionMode !== "goal" || props.disabled) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
  }, [sessionMode, props.disabled, props.forceFollowKey]);

  // Shift+Tab cycles session modes (Cursor parity)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Tab" || !e.shiftKey) return;
      if (modeSwitchDisabled || !props.onCycleSessionMode) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        e.preventDefault();
        props.onCycleSessionMode?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modeSwitchDisabled, props.onCycleSessionMode]);

  return (
    <section className="chat-panel">
      <ChatTranscript
        items={props.items}
        showThinking={props.showThinking}
        status={props.status}
        disabledEmpty={props.disabled}
        starters={props.starters}
        readinessHints={props.readinessHints}
        onPickStarter={props.onPickStarter}
        forceFollowKey={props.forceFollowKey}
        onOpenToolInPanel={props.onOpenToolInPanel}
        editingEntryId={props.editingEntryId}
        editDraft={props.editDraft}
        onEditDraftChange={props.onEditDraftChange}
        onStartEdit={props.onStartEdit}
        onCancelEdit={props.onCancelEdit}
        onConfirmEdit={props.onConfirmEdit}
        onRetract={props.onRetract}
        onRegenerate={props.onRegenerate}
        sessionMode={sessionMode}
        planPath={props.planPath}
        onBuildPlan={props.onBuildPlan}
        onClarifySelect={props.onClarifySelect}
      />

      {props.queuedSteering && props.queuedSteering.length > 0 && (
        <div className="queue-banner">
          已排队 steer：{props.queuedSteering.map((t) => `"${t.slice(0, 40)}"`).join(" · ")}
        </div>
      )}

      {goalVisible && props.goal && (
        <div className="goal-banner" role="status">
          <div className="goal-banner-main">
            <Flag size={14} aria-hidden />
            <span className="goal-banner-label">
              {props.goal.status === "paused"
                ? "已暂停"
                : props.goal.status === "budget_limited"
                  ? "预算用尽"
                  : "目标"}
            </span>
            <span className="goal-banner-condition" title={props.goal.condition}>
              {props.goal.condition}
            </span>
            <span className="goal-banner-meta">
              {props.goal.turns}/{props.goal.maxTurns} 轮 ·{" "}
              {props.goal.tokensUsed}/{props.goal.maxTokens} tok
              {props.goal.lastReason ? ` · ${props.goal.lastReason}` : ""}
            </span>
          </div>
          <div className="goal-banner-actions">
            {goalActive && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={props.onPauseGoal}
                disabled={!props.onPauseGoal || streaming}
                title="暂停自动续轮"
              >
                暂停
              </button>
            )}
            {goalPaused && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={props.onResumeGoal}
                disabled={!props.onResumeGoal || streaming}
                title="继续自动续轮"
              >
                继续
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={props.onClearGoal}
              disabled={!props.onClearGoal || streaming}
              title="清除目标并回到 Agent 模式"
            >
              清除 · Agent
            </button>
          </div>
        </div>
      )}

      <div className="composer">
        <div className="composer-mode-bar">
          <div className="composer-mode-pills" role="group" aria-label="会话模式">
            <button
              type="button"
              className={
                sessionMode === "agent"
                  ? "composer-mode-pill is-active"
                  : "composer-mode-pill"
              }
              data-mode="agent"
              aria-pressed={sessionMode === "agent"}
              disabled={modeSwitchDisabled || !props.onSessionModeChange}
              onClick={() => props.onSessionModeChange?.("agent")}
              title="执行任务并修改文件"
            >
              <Bot size={14} strokeWidth={2} aria-hidden />
              <span>智能体</span>
            </button>
            <button
              type="button"
              className={
                sessionMode === "ask"
                  ? "composer-mode-pill is-active"
                  : "composer-mode-pill"
              }
              data-mode="ask"
              aria-pressed={sessionMode === "ask"}
              disabled={modeSwitchDisabled || !props.onSessionModeChange}
              onClick={() => props.onSessionModeChange?.("ask")}
              title="只读研究与问答，不改文件"
            >
              <Search size={14} strokeWidth={2} aria-hidden />
              <span>调研</span>
            </button>
            <button
              type="button"
              className={
                sessionMode === "plan"
                  ? "composer-mode-pill is-active"
                  : "composer-mode-pill"
              }
              data-mode="plan"
              aria-pressed={sessionMode === "plan"}
              disabled={modeSwitchDisabled || !props.onSessionModeChange}
              onClick={() => props.onSessionModeChange?.("plan")}
              title="只读研究并写出计划"
            >
              <ClipboardList size={14} strokeWidth={2} aria-hidden />
              <span>计划</span>
            </button>
            <button
              type="button"
              className={
                sessionMode === "goal"
                  ? "composer-mode-pill is-active"
                  : "composer-mode-pill"
              }
              data-mode="goal"
              aria-pressed={sessionMode === "goal"}
              disabled={modeSwitchDisabled || !props.onSessionModeChange}
              onClick={() => props.onSessionModeChange?.("goal")}
              title="设定完成条件并自动续轮"
            >
              <Target size={14} strokeWidth={2} aria-hidden />
              <span>目标</span>
            </button>
          </div>
          <div className="composer-mode-actions">
            {sessionMode === "plan" && props.planPath && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={props.onBuildPlan}
                disabled={streaming || !props.onBuildPlan}
                title={props.planPath}
              >
                <Hammer size={14} />
                执行计划
              </button>
            )}
          </div>
        </div>
        <div className="composer-shell">
          <SlashMenu
            open={menuOpen}
            items={filtered}
            query={slashMatch?.query ?? ""}
            highlightIndex={Math.min(
              highlight,
              Math.max(0, filtered.length - 1),
            )}
            onHighlightChange={setHighlight}
            onSelect={selectSlashItem}
            onClose={() => dismissMenu()}
          />
          <AtMenu
            open={atMenuOpen}
            candidates={atCandidates}
            highlightIndex={Math.min(
              atHighlight,
              Math.max(0, atCandidates.length - 1),
            )}
            onHighlightChange={setAtHighlight}
            onSelect={selectAtCandidate}
            onClose={() => dismissAtMenu()}
          />
          {props.apiStatus && (
            <div
              className={`api-status-line api-status-${props.apiStatus.phase}`}
              role="status"
              aria-live="polite"
            >
              <span className="api-status-dot" aria-hidden="true" />
              <span className="api-status-text">
                {props.apiStatus.phase === "thinking" && (
                  <>模型响应中{formatWait(props.apiStatus.waitedMs)}…</>
                )}
                {props.apiStatus.phase === "receiving" && <>正在接收回复…</>}
                {props.apiStatus.phase === "retrying" && (
                  <>自动重试中{formatWait(props.apiStatus.waitedMs)}…</>
                )}
              </span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={props.input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onClick={syncCursor}
            onKeyUp={syncCursor}
            onSelect={syncCursor}
            placeholder={
              props.disabled
                ? "请先打开项目…"
                : props.editingEntryId
                  ? "正在编辑历史消息…"
                  : sessionMode === "ask"
                    ? "调研：只读问答…"
                    : sessionMode === "plan"
                      ? "Plan：描述任务，写计划…"
                      : sessionMode === "goal"
                        ? goalActive
                          ? "补充说明，或点暂停/清除…"
                          : goalPaused
                            ? "目标已暂停 — 点「继续」或清除…"
                            : "输入可验证的完成条件…"
                        : streaming
                          ? "运行中：Enter 发送 steer…"
                          : "输入消息，Enter 发送…"
            }
            disabled={composerLocked}
            rows={2}
            aria-disabled={composerLocked}
            aria-autocomplete="list"
            aria-expanded={menuOpen}
          />
          <div className="composer-toolbar">
            <span className="composer-hint" aria-hidden="true">
              {sessionMode === "ask"
                ? "调研 · 只读 · Shift+Tab"
                : sessionMode === "plan"
                  ? props.planPath
                    ? "Plan · 右栏可编辑 · Shift+Tab"
                    : "Plan · 只读 · write_plan 后执行 · Shift+Tab"
                  : sessionMode === "goal"
                    ? goalActive
                      ? "目标 · 自动续轮 · Shift+Tab"
                      : goalPaused
                        ? "目标 · 已暂停 · Shift+Tab"
                        : "目标 · 发送完成条件 · Shift+Tab"
                    : props.planPath
                      ? "Agent · 右栏可执行计划 · Shift+Tab"
                      : streaming
                        ? "Steer · / 命令 · Shift+Tab"
                        : "Enter 发送 · Shift+Tab"}
            </span>
            <div className="composer-actions">
              {streaming && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={props.onAbort}
                >
                  <Square size={14} />
                  中止
                </button>
              )}
              <button
                type="button"
                className="btn btn-cta btn-sm composer-send"
                onClick={props.onSend}
                disabled={
                  props.disabled ||
                  !props.input.trim() ||
                  Boolean(props.editingEntryId)
                }
              >
                <Send size={14} />
                {streaming ? "Steer" : "发送"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
export const ChatPanel = memo(ChatPanelImpl);
