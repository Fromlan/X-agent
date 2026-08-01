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
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { isWritePlanTool, planFileLabel } from "../hooks/usePlanSession";
import { isDisplayableTranscriptItem } from "../lib/chat-transcript-items";
import {
  formatClarifyReply,
  parseClarifyBlocks,
  type ClarifyQuestion,
} from "../lib/plan-clarify";

/** Estimated row height before measure (px); includes inter-row gap. */
const ESTIMATE_ROW_PX = 72;
const ROW_GAP_PX = 16;
const OVERSCAN = 8;
/**
 * Absolute virtual rows mis-measure while content height races (streaming
 * text / thinking / tools), especially in a narrow pane — items overlap.
 * Use document flow until idle with a long transcript.
 */
const VIRTUALIZE_MIN_ITEMS = 48;

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

function formatMaybeJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const ThinkingBlock = memo(function ThinkingBlock({
  thinking,
  done,
}: {
  thinking: string;
  done: boolean;
}) {
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
});

type UserBubbleProps = {
  item: Extract<ChatItem, { kind: "user" }>;
  canAct: boolean;
  editing: boolean;
  editDraft?: string;
  onEditDraftChange?: (text: string) => void;
  onStartEdit?: (entryId: string, text: string) => void;
  onCancelEdit?: () => void;
  onConfirmEdit?: () => void;
  onRetract?: (entryId: string) => void;
};

const UserBubble = memo(function UserBubble(props: UserBubbleProps) {
  const entryId = props.item.entryId ?? props.item.id;
  return (
    <div className="bubble bubble-user">
      {props.canAct && entryId && (
        <div className="bubble-head">
          <div className="bubble-actions">
            <button
              type="button"
              className="btn btn-ghost bubble-action"
              title="编辑并重发"
              onClick={() => props.onStartEdit?.(entryId, props.item.text)}
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
      {props.editing ? (
        <div className="bubble-edit">
          <textarea
            value={props.editDraft ?? props.item.text}
            onChange={(e) => props.onEditDraftChange?.(e.target.value)}
            rows={4}
          />
          <div className="bubble-edit-actions">
            <button type="button" className="btn" onClick={props.onCancelEdit}>
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
        <UserMessageBody text={props.item.text} />
      )}
    </div>
  );
});

type AssistantBubbleProps = {
  item: Extract<ChatItem, { kind: "assistant" }>;
  showThinking: boolean;
  canAct: boolean;
  sessionMode?: AgentSessionMode;
  onRegenerate?: (userEntryId: string) => void;
  onClarifySelect?: (reply: string) => void;
};

function ClarifyPanel(props: {
  questions: ClarifyQuestion[];
  canAct: boolean;
  onSubmit: (reply: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const allAnswered = props.questions.every((q) => Boolean(selected[q.question]));

  return (
    <div className="clarify-panel" role="group" aria-label="澄清选项">
      {props.questions.map((q) => (
        <div key={q.question} className="clarify-question">
          <div className="clarify-q">{q.question}</div>
          <div className="clarify-options">
            {q.options.map((opt) => {
              const isSelected = selected[q.question] === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  className={
                    isSelected
                      ? "btn btn-secondary btn-sm clarify-option is-selected"
                      : "btn btn-secondary btn-sm clarify-option"
                  }
                  disabled={!props.canAct}
                  aria-pressed={isSelected}
                  onClick={() =>
                    setSelected((prev) => ({ ...prev, [q.question]: opt }))
                  }
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="clarify-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!props.canAct || !allAnswered}
          title={
            allAnswered
              ? "发送全部所选答案"
              : "请为每个问题选择一项后再发送"
          }
          onClick={() => {
            const selections = props.questions.map((q) => ({
              question: q.question,
              option: selected[q.question],
            }));
            props.onSubmit(formatClarifyReply(selections));
          }}
        >
          发送所选
        </button>
      </div>
    </div>
  );
}

const AssistantBubble = memo(function AssistantBubble(
  props: AssistantBubbleProps,
) {
  const userEntryId = props.item.userEntryId;
  const showThinkingBlock = Boolean(
    props.showThinking && props.item.thinking,
  );
  const clarifies =
    props.sessionMode === "plan" && props.item.done
      ? parseClarifyBlocks(props.item.text)
      : [];
  return (
    <div
      className={`bubble bubble-text${props.item.isError ? " is-error" : ""}`}
    >
      {props.canAct && props.item.done && userEntryId && (
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
      {showThinkingBlock && props.item.thinking && (
        <ThinkingBlock
          thinking={props.item.thinking}
          done={props.item.done}
        />
      )}
      <MarkdownBody content={props.item.text} streaming={!props.item.done} />
      {clarifies.length > 0 && props.onClarifySelect && (
        <ClarifyPanel
          questions={clarifies}
          canAct={props.canAct}
          onSubmit={(reply) => props.onClarifySelect?.(reply)}
        />
      )}
    </div>
  );
});

const SystemBubble = memo(function SystemBubble({
  item,
}: {
  item: Extract<ChatItem, { kind: "system" }>;
}) {
  return (
    <div className={`bubble bubble-system level-${item.level ?? "info"}`}>
      {item.text}
    </div>
  );
});

type ToolRowProps = {
  item: Extract<ChatItem, { kind: "tool" }>;
  sessionMode?: AgentSessionMode;
  planPath?: string | null;
  streaming: boolean;
  onOpenToolInPanel?: (toolId: string, args: unknown) => void;
  onBuildPlan?: () => void;
};

const ToolRow = memo(function ToolRow(props: ToolRowProps) {
  const { item } = props;
  return (
    <div className="tool-with-actions">
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
      {isWritePlanTool(item.toolName) &&
        item.done &&
        !item.isError &&
        props.sessionMode === "plan" &&
        props.planPath &&
        props.onBuildPlan && (
          <div className="plan-execute-bar">
            <button
              type="button"
              className="btn btn-cta btn-sm"
              disabled={props.streaming}
              title={props.planPath}
              onClick={props.onBuildPlan}
            >
              <Hammer size={14} aria-hidden />
              执行计划
            </button>
            <span className="plan-execute-path" title={props.planPath}>
              {planFileLabel(props.planPath)}
            </span>
          </div>
        )}
    </div>
  );
});

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
  sessionMode?: AgentSessionMode;
  planPath?: string | null;
  onBuildPlan?: () => void;
  onClarifySelect?: (reply: string) => void;
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

  const displayItems = useMemo(
    () =>
      props.items.filter((item) =>
        isDisplayableTranscriptItem(item, props.showThinking),
      ),
    [props.items, props.showThinking],
  );

  // Flow layout while streaming (or short lists): heights change every delta and
  // absolute virtual rows overlap when measure lags. Virtualize only when idle.
  const useVirtualList =
    !streaming && displayItems.length >= VIRTUALIZE_MIN_ITEMS;

  const virtualizer = useVirtualizer({
    count: useVirtualList ? displayItems.length : 0,
    getScrollElement: () => streamRef.current,
    estimateSize: () => ESTIMATE_ROW_PX,
    overscan: OVERSCAN,
    getItemKey: (index) => displayItems[index]?.id ?? index,
  });

  const renderItem = (item: ChatItem) => {
    if (item.kind === "user") {
      return (
        <UserBubble
          item={item}
          canAct={canAct}
          editing={props.editingEntryId === (item.entryId ?? item.id)}
          editDraft={props.editDraft}
          onEditDraftChange={props.onEditDraftChange}
          onStartEdit={props.onStartEdit}
          onCancelEdit={props.onCancelEdit}
          onConfirmEdit={props.onConfirmEdit}
          onRetract={props.onRetract}
        />
      );
    }
    if (item.kind === "system") {
      return <SystemBubble item={item} />;
    }
    if (item.kind === "assistant") {
      return (
        <AssistantBubble
          item={item}
          showThinking={props.showThinking}
          canAct={canAct}
          sessionMode={props.sessionMode}
          onRegenerate={props.onRegenerate}
          onClarifySelect={props.onClarifySelect}
        />
      );
    }
    return (
      <ToolRow
        item={item}
        sessionMode={props.sessionMode}
        planPath={props.planPath}
        streaming={streaming}
        onOpenToolInPanel={props.onOpenToolInPanel}
        onBuildPlan={props.onBuildPlan}
      />
    );
  };

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
    const last = displayItems.length - 1;
    if (useVirtualList && last >= 0) {
      virtualizer.scrollToIndex(last, {
        align: "end",
        behavior: resolved === "smooth" ? "smooth" : "auto",
      });
    } else if (resolved === "smooth") {
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
    // Re-attach when empty ↔ flow ↔ virtual swaps the contentRef target.
  }, [props.items.length === 0, useVirtualList]);

  useLayoutEffect(() => {
    scheduleFollow();
  }, [props.items, props.status, displayItems.length]);

  useLayoutEffect(() => {
    if (!useVirtualList) return;
    // First paint after enabling virtual mode can miss the scrollport size.
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- length/mode is the signal
  }, [displayItems.length, useVirtualList]);

  useLayoutEffect(() => {
    if (props.forceFollowKey == null) return;
    if (prevFollowKeyRef.current === props.forceFollowKey) return;
    prevFollowKeyRef.current = props.forceFollowKey;
    scrollToBottom("auto");
  }, [props.forceFollowKey]);

  const onJumpClick = () => {
    scrollToBottom("smooth");
  };

  const virtualItems = useVirtualList ? virtualizer.getVirtualItems() : [];
  const totalSize = useVirtualList ? virtualizer.getTotalSize() : 0;

  return (
    <div className="chat-transcript">
      <div className="message-stream" ref={streamRef} tabIndex={-1}>
        {props.items.length === 0 ? (
          <div className="message-stream-inner message-stream-empty" ref={contentRef}>
            {props.disabledEmpty && (
              <div className="empty-state">
                请先打开一个项目文件夹，然后开始对话。
              </div>
            )}

            {!props.disabledEmpty &&
              ((props.starters && props.starters.length > 0) ||
                (props.readinessHints && props.readinessHints.length > 0)) && (
                <div className="empty-state empty-state-starters">
                  <p className="empty-state-title">开始对话</p>
                  <p className="empty-state-hint">选择提示或直接提问</p>
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
          </div>
        ) : useVirtualList ? (
          <div
            className="message-stream-inner message-stream-virtual"
            ref={contentRef}
            style={{ height: totalSize, position: "relative" }}
          >
            {virtualItems.map((virtualRow) => {
              const item = displayItems[virtualRow.index];
              if (!item) return null;
              const isLast = virtualRow.index === displayItems.length - 1;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="virtual-row"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingBottom: isLast ? 0 : ROW_GAP_PX,
                  }}
                >
                  {renderItem(item)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="message-stream-inner message-stream-flow" ref={contentRef}>
            {displayItems.map((item) => (
              <div key={item.id} className="transcript-flow-row">
                {renderItem(item)}
              </div>
            ))}
          </div>
        )}
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
