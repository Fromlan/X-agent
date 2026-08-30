import type {
  AgentSessionMode,
  AgentStatus,
  GoalInfo,
  ImageContent,
  ModelInfo,
  SessionSlashItem,
  ThinkingLevel,
} from "@shared/ipc";
import { isRestorableGoalStatus } from "@shared/ipc";
import type { SessionType } from "@shared/session-type";
import type { ChatItem } from "../stores/chat-store";
import { isPendingUserId } from "../stores/chat-store";
import { ChatTranscript } from "./ChatTranscript";
import { SlashMenu } from "./SlashMenu";
import { AtMenu } from "./AtMenu";
import { SelectMenu } from "./SelectMenu";
import { dbgLog } from "@shared/debug-log";
import {
  Bot,
  Brain,
  ClipboardList,
  Flag,
  Hammer,
  Search,
  Send,
  Square,
  Target,
} from "lucide-react";
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
import { useAtCompletion, type AtPathCandidate } from "../hooks/useAtCompletion";
import { ThinkingOrb } from "./ThinkingOrb";
import { ComposerAttachments } from "./ComposerAttachments";
import { MAX_IMAGE_COUNT, type FileReference } from "../lib/file-attachment";
import type { RefObject } from "react";

/** @-补全 path 候选暂未接入 file-tree IPC；空数组常量化避免每次渲染新建引用。 */
const EMPTY_PATH_CANDIDATES: AtPathCandidate[] = [];

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
  /** Session type (会话类型: code / design). 在空对话时显示. */
  sessionType?: SessionType;
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
  /** 模型 / Thinking / 展示思考 —— 由底部工具条承载 */
  models: ModelInfo[];
  currentModelKey: string;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  onModelChange: (value: string) => void;
  onThinkingChange: (level: ThinkingLevel) => void;
  onToggleThinking: () => void;
  /**
   * Optional external ref for the chat transcript scroll container.
   * Used by parent to track scroll position (e.g. mount TopBar shadow).
   */
  externalStreamRef?: RefObject<HTMLDivElement | null>;
  /** 已附图片 (粘贴截图 / 拖放图片). 非空时 composer 上方显示缩略图 chip. */
  attachments?: ImageContent[];
  /** 已附文件 (拖入 / 粘贴的非图片). 与图片共享同一片 chip 区域. */
  fileRefs?: FileReference[];
  /** Hard cap on attachment count, displayed in chip counter. */
  maxAttachmentCount?: number;
  /** 移除第 i 个图片附件. */
  onRemoveImage?: (index: number) => void;
  /** 移除第 i 个文件附件. */
  onRemoveFile?: (index: number) => void;
  /** 拖文件 / 粘贴文件 → 分类后入 attachments (图片) + fileRefs (其他). */
  onAddFiles?: (files: File[]) => void;
}

/** Render an "已等待 12s" suffix when the wait exceeds 3 seconds. */
function formatWait(waitedMs?: number): string {
  if (typeof waitedMs !== "number" || waitedMs < 3000) return "";
  const sec = Math.round(waitedMs / 1000);
  return `（已等待 ${sec}s）`;
}

/** Thinking level 标签首字母大写展示。 */
function capitalizeLabel(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ChatPanelImpl(props: Props) {
  const streaming =
    props.status === "streaming" || props.status === "retrying";
  const composerLocked = props.disabled || Boolean(props.editingEntryId);
  const sessionMode = props.sessionMode ?? "agent";
  const modeSwitchDisabled = composerLocked || streaming;

  // Drag-over visual for the composer shell. Files dropped anywhere
  // on the shell are accepted (not just on the textarea).
  const [isDragOver, setIsDragOver] = useState(false);
  const attachments = props.attachments ?? [];
  const fileRefs = props.fileRefs ?? [];
  const maxAttachments = props.maxAttachmentCount ?? MAX_IMAGE_COUNT;
  const onShellDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!props.onAddFiles || composerLocked) return;
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!isDragOver) setIsDragOver(true);
      }
    },
    [props.onAddFiles, composerLocked, isDragOver],
  );
  const onShellDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (e.currentTarget === e.target) setIsDragOver(false);
    },
    [],
  );
  const onShellDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!props.onAddFiles || composerLocked) return;
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) props.onAddFiles(files);
    },
    [props.onAddFiles, composerLocked],
  );

  // 底部工具条：模型 / Thinking SelectMenu 的派生数据
  const modelOptions =
    props.models.length === 0
      ? [{ value: "", label: "无可用模型", disabled: true }]
      : props.models.map((m) => {
          const key = `${m.provider}/${m.id}`;
          return { value: key, label: m.name?.trim() || m.id };
        });
  const thinkingOptions = props.thinkingLevels.map((level) => ({
    value: level,
    label: capitalizeLabel(level),
  }));
  const modelDisabled = props.disabled || streaming || props.models.length === 0;
  const thinkingDisabled = props.disabled || streaming;

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
    pathCandidates: EMPTY_PATH_CANDIDATES,
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
      // 闸门认 text + attachments + fileRefs,纯图片也能 Enter 发送。
      const hasContent =
        props.input.trim().length > 0 ||
        attachments.length > 0 ||
        fileRefs.length > 0;
      if (hasContent) props.onSend();
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
        sessionType={props.sessionType}
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
        externalStreamRef={props.externalStreamRef}
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
        <div
          className="composer-shell"
          data-session-mode={sessionMode}
          data-streaming={streaming ? "true" : undefined}
          data-dragover={isDragOver ? "true" : undefined}
          onDragOver={onShellDragOver}
          onDragLeave={onShellDragLeave}
          onDrop={onShellDrop}
        >
          <ComposerAttachments
            attachments={attachments}
            fileRefs={fileRefs}
            onRemoveImage={(i) => props.onRemoveImage?.(i)}
            onRemoveFile={(i) => props.onRemoveFile?.(i)}
            maxImageCount={maxAttachments}
          />
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
          {props.apiStatus ? (
            <div
              className={`api-status-line api-status-${props.apiStatus.phase}`}
              role="status"
              aria-live="polite"
            >
              {/* per-phase orb: thinking→orbits, receiving→wave, retrying→constellation */}
              <ThinkingOrb
                state={
                  props.apiStatus.phase === "receiving"
                    ? "listening"
                    : props.apiStatus.phase === "retrying"
                      ? "connecting"
                      : "working"
                }
                size={20}
                aria-hidden="true"
              />
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
          ) : (
            // idle: always-on breathing ring + ready label
            <div
              className="api-status-line api-status-idle"
              role="status"
              aria-live="polite"
            >
              <ThinkingOrb state="breathing" size={20} aria-hidden="true" />
              <span className="api-status-text">已就绪</span>
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
            onPaste={(e) => {
              if (!props.onAddFiles || composerLocked) return;
              const items = e.clipboardData?.items;
              if (!items) return;
              for (const it of items) {
                if (it.kind === "file" && it.type.startsWith("image/")) {
                  const f = it.getAsFile();
                  if (f) {
                    e.preventDefault();
                    props.onAddFiles([f]);
                    return;
                  }
                }
              }
              // 非图片的 paste 走默认行为 (粘贴纯文本)
            }}
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
          <div className="composer-toolbar" role="toolbar" aria-label="会话控制">
            <div className="composer-mode-row" role="group" aria-label="会话模式">
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
                <span className="composer-mode-pill-text">智能体</span>
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
                <span className="composer-mode-pill-text">调研</span>
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
                <span className="composer-mode-pill-text">计划</span>
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
                <span className="composer-mode-pill-text">目标</span>
              </button>
              {sessionMode === "plan" && props.planPath && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm composer-build-plan"
                  onClick={props.onBuildPlan}
                  disabled={streaming || !props.onBuildPlan}
                  title={props.planPath}
                >
                  <Hammer size={14} />
                  执行计划
                </button>
              )}
            </div>
            <div className="composer-model-row">
              <div className="field" title="模型">
                <span className="field-label">模型</span>
                <SelectMenu
                  variant="pill"
                  className="select-menu-centered"
                  value={props.currentModelKey}
                  options={modelOptions}
                  onChange={props.onModelChange}
                  disabled={modelDisabled}
                  aria-label="模型"
                  placeholder="选择模型"
                />
              </div>
              <div className="field" title="Thinking">
                <span className="field-label">Thinking</span>
                <SelectMenu
                  variant="pill"
                  className="select-menu-compact select-menu-centered"
                  value={props.thinkingLevel}
                  options={thinkingOptions}
                  onChange={(v) => {
                    // DEBUG(thinking-switch #30): 渲染端 SelectMenu 选值时打点
                    dbgLog("renderer", "thinking SelectMenu onChange", {
                      picked: v,
                      currentValue: props.thinkingLevel,
                    });
                    props.onThinkingChange(v as ThinkingLevel);
                  }}
                  disabled={thinkingDisabled}
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
            </div>
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
                  Boolean(props.editingEntryId) ||
                  // 闸门认 text + attachments + fileRefs,纯图片 / 纯文件也能发。
                  (!props.input.trim() &&
                    attachments.length === 0 &&
                    fileRefs.length === 0) ||
                  // B7: 已有未确认的 pending 气泡时禁止再发（双 pending 会错位归并）
                  props.items.some(
                    (i) =>
                      i.kind === "user" &&
                      isPendingUserId(i.id) &&
                      !i.entryId,
                  )
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
