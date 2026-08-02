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
import {
  applySlashItemInsert,
  detectSlashFragment,
  filterSlashItemsByQuery,
  type SlashMatch,
} from "../lib/slash-menu";
import { Flag, Hammer, Send, Square } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

interface Props {
  items: ChatItem[];
  showThinking: boolean;
  status: AgentStatus;
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

export function ChatPanel(props: Props) {
  const streaming =
    props.status === "streaming" || props.status === "retrying";
  const composerLocked = props.disabled || Boolean(props.editingEntryId);
  const sessionMode = props.sessionMode ?? "agent";
  const modeSwitchDisabled = composerLocked || streaming;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const [slashItems, setSlashItems] = useState<SessionSlashItem[]>([]);
  const [slashItemsLoaded, setSlashItemsLoaded] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);

  const slashMatch: SlashMatch | null = useMemo(() => {
    if (composerLocked) return null;
    return detectSlashFragment(props.input, cursor);
  }, [composerLocked, props.input, cursor]);

  const menuOpen = Boolean(slashMatch) && !menuDismissed;

  const filtered = useMemo(
    () => filterSlashItemsByQuery(slashItems, slashMatch?.query ?? ""),
    [slashItems, slashMatch?.query],
  );

  useEffect(() => {
    setSlashItemsLoaded(false);
    setSlashItems([]);
  }, [props.skillsRefreshKey, props.disabled]);

  useEffect(() => {
    if (!menuOpen || slashItemsLoaded || props.disabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await window.xAgent.listSessionSlashItems();
        if (!cancelled) {
          setSlashItems(list);
          setSlashItemsLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setSlashItems([]);
          setSlashItemsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [menuOpen, slashItemsLoaded, props.disabled]);

  useEffect(() => {
    setHighlight(0);
  }, [slashMatch?.query, slashMatch?.start]);

  useEffect(() => {
    if (!slashMatch) setMenuDismissed(false);
  }, [slashMatch]);

  const selectSlashItem = useCallback(
    (item: SessionSlashItem) => {
      const match = detectSlashFragment(
        props.input,
        textareaRef.current?.selectionStart ?? cursor,
      );
      if (!match) return;
      const { value, cursor: nextCursor } = applySlashItemInsert(
        props.input,
        match,
        item,
      );
      props.setInput(value);
      setMenuDismissed(true);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
        setCursor(nextCursor);
      });
    },
    [cursor, props],
  );

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    props.setInput(e.target.value);
    setCursor(e.target.selectionStart);
    setMenuDismissed(false);
  };

  const syncCursor = () => {
    const el = textareaRef.current;
    if (el) setCursor(el.selectionStart);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuDismissed(true);
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
              disabled={modeSwitchDisabled || !props.onSessionModeChange}
              onClick={() => props.onSessionModeChange?.("agent")}
            >
              Agent
            </button>
            <button
              type="button"
              className={
                sessionMode === "ask"
                  ? "composer-mode-pill is-active"
                  : "composer-mode-pill"
              }
              disabled={modeSwitchDisabled || !props.onSessionModeChange}
              onClick={() => props.onSessionModeChange?.("ask")}
              title="只读研究与问答，不改文件"
            >
              调研
            </button>
            <button
              type="button"
              className={
                sessionMode === "plan"
                  ? "composer-mode-pill is-active"
                  : "composer-mode-pill"
              }
              disabled={modeSwitchDisabled || !props.onSessionModeChange}
              onClick={() => props.onSessionModeChange?.("plan")}
              title="只读研究并写出计划"
            >
              Plan
            </button>
            <button
              type="button"
              className={
                sessionMode === "goal"
                  ? "composer-mode-pill is-active"
                  : "composer-mode-pill"
              }
              disabled={modeSwitchDisabled || !props.onSessionModeChange}
              onClick={() => props.onSessionModeChange?.("goal")}
              title="设定完成条件并自动续轮"
            >
              目标
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
            onClose={() => setMenuDismissed(true)}
          />
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
