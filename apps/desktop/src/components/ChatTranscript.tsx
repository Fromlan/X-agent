import type { AgentSessionMode, AgentStatus } from "@shared/ipc";
import type { ChatItem } from "../stores/chat-store";
import {
  initialChatScrollPinState,
  isNearBottom,
  isScrollUnpinKey,
  isScrollable,
  isVerticalScrollbarPointer,
  isWheelUnpinDelta,
  reduceChatScrollPin,
  shouldFollow,
  type ChatScrollPinState,
} from "../lib/chat-scroll-pin";
import { MarkdownBody } from "./MarkdownBody";
import { ToolCard } from "./ToolCard";
import { UserMessageBody } from "./UserMessageBody";
import { ArrowDown, Brain, Hammer, Pencil, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

function planFileLabel(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

const VIRTUALIZE_THRESHOLD = 60;
const VIRTUALIZE_TAIL = 40;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function metricsOf(el: HTMLElement) {
  return {
    scrollHeight: el.scrollHeight,
    scrollTop: el.scrollTop,
    clientHeight: el.clientHeight,
  };
}

function ThinkingBlock({ thinking, done }: { thinking: string; done: boolean }) {
  const [open, setOpen] = useState(!done);

  useEffect(() => {
    if (!done) setOpen(true);
  }, [done]);

  return (
    <details
      className="bubble-thinking"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <Brain size={12} />
        思考过程
      </summary>
      <pre>{thinking}</pre>
    </details>
  );
}

function formatMaybeJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export type ChatStarterChip = {
  id: string;
  label: string;
  prompt: string;
};

export interface ChatTranscriptProps {
  items: ChatItem[];
  showThinking: boolean;
  status?: AgentStatus;
  disabledEmpty?: boolean;
  /** Starters shown when project is open but transcript is empty. */
  starters?: ChatStarterChip[];
  readinessHints?: { label: string; onClick: () => void }[];
  onPickStarter?: (prompt: string) => void;
  /** Changes when send / session switch should force stick-to-bottom. */
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
  /** When true, skip heavy Markdown for non-tail bubbles. */
  degradeMarkdown?: boolean;
  sessionMode?: AgentSessionMode;
  planPath?: string | null;
  onBuildPlan?: () => void;
}

export function ChatTranscript(props: ChatTranscriptProps) {
  const idle = props.status === "idle" || props.status === "error";
  const canAct = idle && !props.editingEntryId;
  const streaming =
    props.status === "streaming" || props.status === "retrying";

  const streamRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinStateRef = useRef<ChatScrollPinState>(initialChatScrollPinState());
  const followScheduledRef = useRef(false);
  const prevFollowKeyRef = useRef<string | undefined>(undefined);
  const [showJump, setShowJump] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);

  useEffect(() => {
    setShowAllHistory(false);
  }, [props.forceFollowKey]);

  const visibleItems = useMemo(() => {
    const items = props.items;
    if (showAllHistory || items.length <= VIRTUALIZE_THRESHOLD) {
      return { hidden: 0, items };
    }
    const start = Math.max(0, items.length - VIRTUALIZE_TAIL);
    return { hidden: start, items: items.slice(start) };
  }, [props.items, showAllHistory]);

  const plainMarkdownCutoff = useMemo(() => {
    if (!props.degradeMarkdown && !streaming) return -1;
    return Math.max(0, props.items.length - 6);
  }, [props.degradeMarkdown, streaming, props.items.length]);

  const syncJumpVisibility = () => {
    const el = streamRef.current;
    if (!el) {
      setShowJump(false);
      return;
    }
    setShowJump(!shouldFollow(pinStateRef.current) && isScrollable(metricsOf(el)));
  };

  const applyPin = (next: ChatScrollPinState) => {
    pinStateRef.current = next;
  };

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const el = streamRef.current;
    if (!el) return;
    applyPin(reduceChatScrollPin(pinStateRef.current, { type: "force_pin" }));
    const resolved: ScrollBehavior =
      behavior === "smooth" && prefersReducedMotion() ? "auto" : behavior;
    if (resolved === "smooth") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    setShowJump(false);
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        applyPin(
          reduceChatScrollPin(pinStateRef.current, {
            type: "programmatic_follow_end",
          }),
        );
        applyPin(
          reduceChatScrollPin(pinStateRef.current, {
            type: "scroll",
            nearBottom: isNearBottom(metricsOf(el)),
          }),
        );
        syncJumpVisibility();
      });
    });
  };

  const followIfPinned = () => {
    if (!shouldFollow(pinStateRef.current)) {
      syncJumpVisibility();
      return;
    }
    const el = streamRef.current;
    if (!el) return;
    applyPin(
      reduceChatScrollPin(pinStateRef.current, {
        type: "programmatic_follow_start",
      }),
    );
    el.scrollTop = el.scrollHeight;
    // Second frame: layout may still grow (tool cards / markdown); keep pinned
    // and only then clear the ignore window + sync jump button.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        applyPin(
          reduceChatScrollPin(pinStateRef.current, {
            type: "programmatic_follow_end",
          }),
        );
        // Re-assert pin from geometry after ignore clears.
        applyPin(
          reduceChatScrollPin(pinStateRef.current, {
            type: "scroll",
            nearBottom: isNearBottom(metricsOf(el)),
          }),
        );
        syncJumpVisibility();
      });
    });
  };

  const scheduleFollow = () => {
    if (followScheduledRef.current) return;
    followScheduledRef.current = true;
    requestAnimationFrame(() => {
      followScheduledRef.current = false;
      followIfPinned();
    });
  };

  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;

    const unpinFromUser = () => {
      applyPin(
        reduceChatScrollPin(pinStateRef.current, { type: "user_intent_unpin" }),
      );
      syncJumpVisibility();
    };

    const onScroll = () => {
      applyPin(
        reduceChatScrollPin(pinStateRef.current, {
          type: "scroll",
          nearBottom: isNearBottom(metricsOf(el)),
        }),
      );
      syncJumpVisibility();
    };

    // Only unpin when the user scrolls toward older content. Wheel-down toward
    // latest must not break stick-to-bottom.
    const onWheel = (e: WheelEvent) => {
      if (isWheelUnpinDelta(e.deltaY)) {
        unpinFromUser();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!isVerticalScrollbarPointer(el, e.clientX, e.clientY)) return;
      // While streaming, programmatic follow keeps ignoreProgrammatic true, so
      // scroll events alone cannot unpin. Explicitly unpin once the thumb leaves
      // the bottom during a scrollbar drag.
      const onMove = () => {
        if (!isNearBottom(metricsOf(el))) {
          unpinFromUser();
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        if (!isNearBottom(metricsOf(el))) {
          unpinFromUser();
        } else {
          onScroll();
        }
      };
      window.addEventListener("pointermove", onMove, {
        capture: true,
        passive: true,
      });
      window.addEventListener("pointerup", onUp, { capture: true });
    };

    let touchLastY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchLastY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y == null || touchLastY == null) return;
      // Finger moving down → content scrolls up (older messages) → unpin.
      if (y - touchLastY > 8) {
        unpinFromUser();
        touchLastY = y;
      } else if (y < touchLastY) {
        touchLastY = y;
      }
    };
    const onTouchEnd = () => {
      touchLastY = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isScrollUnpinKey(e.key)) {
        unpinFromUser();
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true, capture: true });
    el.addEventListener("pointerdown", onPointerDown, {
      passive: true,
      capture: true,
    });
    el.addEventListener("touchstart", onTouchStart, {
      passive: true,
      capture: true,
    });
    el.addEventListener("touchmove", onTouchMove, {
      passive: true,
      capture: true,
    });
    el.addEventListener("touchend", onTouchEnd, {
      passive: true,
      capture: true,
    });
    el.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel, true);
      el.removeEventListener("pointerdown", onPointerDown, true);
      el.removeEventListener("touchstart", onTouchStart, true);
      el.removeEventListener("touchmove", onTouchMove, true);
      el.removeEventListener("touchend", onTouchEnd, true);
      el.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const ro = new ResizeObserver(() => {
      scheduleFollow();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    scheduleFollow();
  }, [props.items, props.status]);

  useLayoutEffect(() => {
    if (props.forceFollowKey == null) return;
    if (prevFollowKeyRef.current === props.forceFollowKey) return;
    prevFollowKeyRef.current = props.forceFollowKey;
    scrollToBottom("auto");
  }, [props.forceFollowKey]);

  const onJumpClick = () => {
    scrollToBottom("smooth");
  };

  return (
    <div className="chat-transcript">
      <div className="message-stream" ref={streamRef} tabIndex={-1}>
        <div className="message-stream-inner" ref={contentRef}>
          {props.items.length === 0 && props.disabledEmpty && (
            <div className="empty-state">请先打开一个项目文件夹，然后开始对话。</div>
          )}

          {props.items.length === 0 &&
            !props.disabledEmpty &&
            ((props.starters && props.starters.length > 0) ||
              (props.readinessHints && props.readinessHints.length > 0)) && (
              <div className="empty-state empty-state-starters">
                <p className="empty-state-title">开始对话</p>
                <p className="empty-state-hint">
                  选择下方提示，或直接在输入框提问。
                </p>
                {props.readinessHints && props.readinessHints.length > 0 && (
                  <div className="empty-ready-hints">
                    {props.readinessHints.map((hint) => (
                      <button
                        key={hint.label}
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={hint.onClick}
                      >
                        {hint.label}
                      </button>
                    ))}
                  </div>
                )}
                {props.starters && props.starters.length > 0 && (
                  <div className="starter-chips">
                    {props.starters.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="starter-chip"
                        onClick={() => props.onPickStarter?.(s.prompt)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

          {visibleItems.hidden > 0 && (
            <div className="history-virtualize-bar">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAllHistory(true)}
              >
                显示更早的 {visibleItems.hidden} 条消息
              </button>
            </div>
          )}

          {visibleItems.items.map((item, i) => {
            const absoluteIndex = visibleItems.hidden + i;
            if (item.kind === "user") {
              const entryId = item.entryId ?? item.id;
              const editing = props.editingEntryId === entryId;
              return (
                <div key={item.id} className="bubble bubble-user">
                  {canAct && entryId && (
                    <div className="bubble-head">
                      <div className="bubble-actions">
                        <button
                          type="button"
                          className="btn btn-ghost bubble-action"
                          title="编辑并重发"
                          onClick={() => props.onStartEdit?.(entryId, item.text)}
                        >
                          <Pencil size={12} strokeWidth={2} />
                          <span>编辑</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost bubble-action"
                          title="撤回对话并还原文件"
                          onClick={() => props.onRetract?.(entryId)}
                        >
                          <Undo2 size={12} strokeWidth={2} />
                          <span>撤回</span>
                        </button>
                      </div>
                    </div>
                  )}
                  {editing ? (
                    <div className="bubble-edit">
                      <textarea
                        value={props.editDraft ?? item.text}
                        onChange={(e) => props.onEditDraftChange?.(e.target.value)}
                        rows={4}
                      />
                      <div className="bubble-edit-actions">
                        <button
                          type="button"
                          className="btn"
                          onClick={props.onCancelEdit}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="btn btn-cta"
                          onClick={props.onConfirmEdit}
                          disabled={!props.editDraft?.trim()}
                        >
                          重发
                        </button>
                      </div>
                    </div>
                  ) : (
                    <UserMessageBody text={item.text} />
                  )}
                </div>
              );
            }

            if (item.kind === "system") {
              return (
                <div
                  key={item.id}
                  className={`bubble bubble-system level-${item.level ?? "info"}`}
                >
                  {item.text}
                </div>
              );
            }

            if (item.kind === "assistant") {
              const userEntryId = item.userEntryId;
              const showThinkingBlock =
                Boolean(props.showThinking && item.thinking);
              const hasText = Boolean(item.text.trim());
              // Thinking-only turns leave an empty shell when thinking is hidden.
              if (!showThinkingBlock && !hasText) {
                return null;
              }
              const usePlain =
                plainMarkdownCutoff >= 0 && absoluteIndex < plainMarkdownCutoff;
              return (
                <div
                  key={item.id}
                  className={`bubble bubble-text${item.isError ? " is-error" : ""}`}
                >
                  {canAct && item.done && userEntryId && (
                    <div className="bubble-head">
                      <div className="bubble-actions">
                        <button
                          type="button"
                          className="btn btn-ghost bubble-action"
                          title="重新生成"
                          onClick={() => props.onRegenerate?.(userEntryId)}
                        >
                          <RotateCcw size={12} strokeWidth={2} />
                          <span>重新生成</span>
                        </button>
                      </div>
                    </div>
                  )}
                  {showThinkingBlock && item.thinking && (
                    <ThinkingBlock thinking={item.thinking} done={item.done} />
                  )}
                  <MarkdownBody
                    content={item.text}
                    streaming={!item.done}
                    plain={usePlain}
                  />
                </div>
              );
            }

            return (
              <div key={item.id} className="tool-with-actions">
                <ToolCard
                  toolCallId={item.id}
                  toolName={item.toolName}
                  args={item.args}
                  result={formatMaybeJson(item.result)}
                  isError={item.isError}
                  done={item.done}
                  onOpenInPanel={
                    props.onOpenToolInPanel
                      ? () => props.onOpenToolInPanel?.(item.id, item.args)
                      : undefined
                  }
                />
                {item.toolName === "write_plan" &&
                  item.done &&
                  !item.isError &&
                  props.sessionMode === "plan" &&
                  props.planPath &&
                  props.onBuildPlan && (
                    <div className="plan-execute-bar">
                      <button
                        type="button"
                        className="btn btn-cta btn-sm"
                        disabled={streaming}
                        title={props.planPath}
                        onClick={props.onBuildPlan}
                      >
                        <Hammer size={14} aria-hidden />
                        执行计划
                      </button>
                      <span
                        className="plan-execute-path"
                        title={props.planPath}
                      >
                        {planFileLabel(props.planPath)}
                      </span>
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      </div>

      {showJump && (
        <button
          type="button"
          className="btn btn-ghost scroll-to-bottom"
          aria-label="回到底部"
          title="回到底部"
          onClick={onJumpClick}
        >
          <ArrowDown size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
