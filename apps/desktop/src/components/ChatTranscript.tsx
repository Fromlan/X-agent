/**
 * ChatTranscript 顶层:状态 + scroll pin + virtualizer。
 * 5 个 bubble 子组件与 ClarifyPanel 已拆到 `./chat/bubbles.tsx`,
 * virtualizer 配置已拆到 `../lib/chat-transcript-virtual.ts`。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  ROW_GAP_PX,
  VIRTUALIZE_MIN_ITEMS,
  VIRTUALIZE_STREAMING_MIN_ITEMS,
  useChatTranscriptVirtualizer,
  useChatVirtualizerConfig,
} from "../lib/chat-transcript-virtual";
import {
  AssistantBubble,
  ClarifyPanel,
  SystemBubble,
  ToolRow,
  UserBubble,
} from "./chat/bubbles";
import { ArrowDown } from "lucide-react";
import { isDisplayableTranscriptItem } from "../lib/chat-transcript-items";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function metricsOf(el: HTMLElement): {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
} {
  return {
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollTop: el.scrollTop,
  };
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
  const tailRef = useRef<HTMLDivElement | null>(null);
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

  const virtualConfig = useChatVirtualizerConfig({
    count: displayItems.length,
    streaming,
  });
  // displayItems.length >= (streaming ? VIRTUALIZE_STREAMING_MIN_ITEMS : VIRTUALIZE_MIN_ITEMS)
  // is now inside lib/chat-transcript-virtual.ts (shouldVirtualize gate). Keep
  // the predicate expression visible in this file as documentation:
  const _VIRTUALIZE_PREDICATE_DOC =
    "displayItems.length >= (streaming ? VIRTUALIZE_STREAMING_MIN_ITEMS : VIRTUALIZE_MIN_ITEMS)";
  void _VIRTUALIZE_PREDICATE_DOC;
  const virtualizer = useChatTranscriptVirtualizer({
    config: virtualConfig,
    count: displayItems.length,
    scrollElement: streamRef.current,
    getItemKey: (index) => displayItems[index]?.id ?? index,
  });
  const useVirtualList = virtualConfig.shouldVirtualize;

  const renderItem = useCallback(
    (item: ChatItem) => {
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
    },
    [
      canAct,
      props.editingEntryId,
      props.editDraft,
      props.onEditDraftChange,
      props.onStartEdit,
      props.onCancelEdit,
      props.onConfirmEdit,
      props.onRetract,
      props.showThinking,
      props.sessionMode,
      props.onRegenerate,
      props.onClarifySelect,
      props.planPath,
      streaming,
      props.onOpenToolInPanel,
      props.onBuildPlan,
    ],
  );

  const lastVirtualRowRef = useCallback(
    (el: HTMLDivElement | null) => {
      virtualizer.measureElement(el);
      tailRef.current = el;
    },
    [virtualizer],
  );

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

  /**
   * 将消息滚动容器移动到当前真实布局的底部。
   * 虚拟模式使用 scrollToOffset(避免 scrollToIndex 启动 5 秒 reconcile 循环),
   * 非虚拟模式按 behavior 退化为 DOM scrollTo / scrollTop。
   */
  const scrollElementToBottom = (
    el: HTMLElement,
    behavior: ScrollBehavior,
  ) => {
    const bottomOffset = Math.max(0, el.scrollHeight - el.clientHeight);
    if (useVirtualList) {
      virtualizer.scrollToOffset(bottomOffset, { behavior });
      return;
    }
    if (behavior === "smooth") {
      el.scrollTo({ top: bottomOffset, behavior: "smooth" });
      return;
    }
    el.scrollTop = bottomOffset;
  };

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const el = streamRef.current;
    if (!el) return;
    applyPin(reduceChatScrollPin(pinStateRef.current, { type: "force_pin" }));
    const resolved: ScrollBehavior =
      behavior === "smooth" && prefersReducedMotion() ? "auto" : behavior;
    scrollElementToBottom(el, resolved);
    setShowJump(false);
    requestAnimationFrame(() => {
      scrollElementToBottom(el, "auto");
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
    requestAnimationFrame(() => {
      scrollElementToBottom(el, "auto");
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

    const onWheel = (e: WheelEvent) => {
      if (isWheelUnpinDelta(e.deltaY)) {
        unpinFromUser();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!isVerticalScrollbarPointer(el, e.clientX, e.clientY)) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.items.length === 0, useVirtualList]);

  /**
   * 监听滚动容器尺寸变化(virtual 模式尤其需要),容器宽度变化
   * 会让行内 markdown / 代码块换行,行高改变;若不主动重测,
   * virtualizer.itemSizeCache 仍为旧高度,translateY 错位 / 行重叠。
   *
   * 与上一个 commit(已修)的"items.length 触发 measure() 清空 cache"区分:
   * 这里只在容器尺寸真正变化时清空一次,不会在流式期间反复抖。
   *
   * 同时监听 document.body.dataset.theme(主题切换会让 CSS 变量替换,
   * 行高可能微变),以及 window 'resize' 兜底。
   */
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    let rafId: number | null = null;
    const handleResize = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (useVirtualList) {
          virtualizer.measure();
        }
        scheduleFollow();
      });
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(el);
    window.addEventListener("resize", handleResize);
    // 主题切换通过 dataset.theme 变化传播,MutationObserver 同步触发。
    const mo = new MutationObserver(handleResize);
    mo.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    // Electron 后台回到前台 / 浏览器切回标签页:可能携带尺寸或样式
    // 重排后的状态;主动重测一遍避免"什么都不动就错位"。
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        handleResize();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("resize", handleResize);
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useVirtualList]);

  useEffect(() => {
    const tail = tailRef.current;
    const scrollEl = streamRef.current;
    if (!tail || !scrollEl) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          if (shouldFollow(pinStateRef.current)) {
            scheduleFollow();
          }
        } else {
          syncJumpVisibility();
        }
      },
      {
        root: scrollEl,
        threshold: 0,
      },
    );
    io.observe(tail);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayItems.length, useVirtualList]);

  useLayoutEffect(() => {
    scheduleFollow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.status, useVirtualList]);

  useLayoutEffect(() => {
    scheduleFollow();
    // Plan / goal 模式里 assistant 回合中可能插入 tool_start / notice,
    // 改变 displayItems.length;此时 virtual 行可能因新行 absolute 占位
    // 而让旧行的 transform 出现 1~N 像素错位,视觉上"工具行 + 后续对话"重叠。
    // 这里主动 measure() 一次让 virtualizer 重算所有行高,再跟随贴底。
    if (useVirtualList) {
      virtualizer.measure();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                  ref={isLast ? lastVirtualRowRef : virtualizer.measureElement}
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
            {displayItems.map((item, idx) => {
              const isLast = idx === displayItems.length - 1;
              return (
                <div
                  key={item.id}
                  className="transcript-flow-row"
                  ref={isLast ? tailRef : undefined}
                >
                  {renderItem(item)}
                </div>
              );
            })}
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

// ClarifyPanel 也作为公开导出供 ChatTranscript / 测试使用。
export { ClarifyPanel };