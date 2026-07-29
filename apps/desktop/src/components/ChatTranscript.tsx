import type { AgentStatus } from "@shared/ipc";
import type { ChatItem } from "../stores/chat-store";
import {
  initialChatScrollPinState,
  isNearBottom,
  isScrollUnpinKey,
  isScrollable,
  isVerticalScrollbarPointer,
  reduceChatScrollPin,
  shouldFollow,
  type ChatScrollPinState,
} from "../lib/chat-scroll-pin";
import { MarkdownBody } from "./MarkdownBody";
import { ToolCard } from "./ToolCard";
import { ArrowDown, Brain, Pencil, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

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

export interface ChatTranscriptProps {
  items: ChatItem[];
  showThinking: boolean;
  status?: AgentStatus;
  disabledEmpty?: boolean;
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
}

export function ChatTranscript(props: ChatTranscriptProps) {
  const idle = props.status === "idle" || props.status === "error";
  const canAct = idle && !props.editingEntryId;

  const streamRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinStateRef = useRef<ChatScrollPinState>(initialChatScrollPinState());
  const followScheduledRef = useRef(false);
  const prevFollowKeyRef = useRef<string | undefined>(undefined);
  const [showJump, setShowJump] = useState(false);

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
      applyPin(
        reduceChatScrollPin(pinStateRef.current, {
          type: "programmatic_follow_end",
        }),
      );
      syncJumpVisibility();
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
    requestAnimationFrame(() => {
      applyPin(
        reduceChatScrollPin(pinStateRef.current, {
          type: "programmatic_follow_end",
        }),
      );
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

    const onWheel = () => {
      unpinFromUser();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (isVerticalScrollbarPointer(el, e.clientX, e.clientY)) {
        unpinFromUser();
      }
    };

    const onTouchStart = () => {
      unpinFromUser();
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
    el.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel, true);
      el.removeEventListener("pointerdown", onPointerDown, true);
      el.removeEventListener("touchstart", onTouchStart, true);
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

          {props.items.map((item) => {
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
                    <pre>{item.text}</pre>
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
                  <MarkdownBody content={item.text} streaming={!item.done} />
                </div>
              );
            }

            return (
              <ToolCard
                key={item.id}
                toolCallId={item.id}
                toolName={item.toolName}
                args={formatMaybeJson(item.args)}
                result={formatMaybeJson(item.result)}
                isError={item.isError}
                done={item.done}
                onOpenInPanel={
                  props.onOpenToolInPanel
                    ? () => props.onOpenToolInPanel?.(item.id, item.args)
                    : undefined
                }
              />
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
