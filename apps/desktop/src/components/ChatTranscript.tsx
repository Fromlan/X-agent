/**
 * ChatTranscript 顶层:状态 + scroll pin + virtualizer。
 *
 * 分层说明:
 *   - `props.items`:外部传入的 ChatItem[] (来自 chat-store / applyAgentEvent)
 *   - `displayItems`:经 `isDisplayableTranscriptItem` 过滤的可显示条目 (数据层)
 *   - `renderItems`:`deriveToolBatches(displayItems)` 把连续 tool 合并后的渲染节点
 *     (视图层; virtualizer / 流式尾行追踪 / getItemKey / renderItem 均基于此)
 *
 * 视图层从数据层派生,因此:
 *   - 撤回 / 重新生成仍按 ChatItem.entryId 切片,不受批次影响
 *   - history_replace 替换数组后本组件重新派生 renderItems
 *   - 持久化的会话文件不感知批次
 *
 * 5 个 bubble 子组件与 ClarifyPanel 已拆到 `./chat/bubbles.tsx`,
 * 工具批次容器在 `./chat/ToolBatch.tsx`,
 * virtualizer 配置已拆到 `../lib/chat-transcript-virtual.ts`,
 * 批次合并逻辑在 `../lib/chat-tool-batches.ts`。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentSessionMode, AgentStatus } from "@shared/ipc";
import type { ChatItem } from "../stores/chat-store";
import {
  initialChatScrollPinState,
  isNearBottom,
  isScrollable,
  isVerticalScrollbarPointer,
  reduceChatScrollPin,
  shouldFollow,
  type ChatScrollPinState,
} from "../lib/chat-scroll-pin";
import {
  isUnpinKeyEvent,
  isUnpinPointerEvent,
  isUnpinTouchGesture,
} from "../lib/chat-unpin-input";
import {
  ROW_GAP_PX,
  VIRTUALIZE_MIN_ITEMS,
  VIRTUALIZE_STREAMING_MIN_ITEMS,
  useChatTranscriptVirtualizer,
  useChatVirtualizerConfig,
} from "../lib/chat-transcript-virtual";
import {
  deriveToolBatches,
  type RenderItem,
} from "../lib/chat-tool-batches";
import {
  AssistantBubble,
  ClarifyPanel,
  SystemBubble,
  ToolRow,
  UserBubble,
} from "./chat/bubbles";
import { ToolBatch } from "./chat/ToolBatch";
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

/**
 * 计算聊天行的层叠顺序，让上方气泡的溢出内容可以覆盖下方行。
 * 虚拟行通过 transform 形成独立层叠上下文，因此必须在行本身设置顺序，
 * 只提高气泡子节点的 z-index 无法越过相邻虚拟行。
 */
function transcriptRowZIndex(index: number, itemCount: number): number {
  return itemCount - index;
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

  /** 数据层:经 `isDisplayableTranscriptItem` 过滤的可显示 ChatItem。 */
  const displayItems = useMemo(
    () =>
      props.items.filter((item) =>
        isDisplayableTranscriptItem(item, props.showThinking),
      ),
    [props.items, props.showThinking],
  );

  /**
   * 视图层:把连续 tool 合并为批次。虚拟行 / getItemKey / 渲染分支都基于此,
   * 让 N 个连续 tool 在 DOM 与虚拟行里只占 1 行。
   */
  const renderItems = useMemo<RenderItem[]>(
    () => deriveToolBatches(displayItems),
    [displayItems],
  );

  const virtualConfig = useChatVirtualizerConfig({
    count: renderItems.length,
    streaming,
  });
  // renderItems.length >= (streaming ? VIRTUALIZE_STREAMING_MIN_ITEMS : VIRTUALIZE_MIN_ITEMS)
  // is inside lib/chat-transcript-virtual.ts (shouldVirtualize gate).
  const virtualizer = useChatTranscriptVirtualizer({
    config: virtualConfig,
    count: renderItems.length,
    scrollElement: streamRef.current,
    getItemKey: (index) => renderItems[index]?.id ?? index,
  });
  const useVirtualList = virtualConfig.shouldVirtualize;

  const renderItem = useCallback(
    (item: RenderItem) => {
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
      if (item.kind === "toolBatch") {
        return (
          <ToolBatch
            item={item}
            sessionMode={props.sessionMode}
            planPath={props.planPath}
            streaming={streaming}
            onOpenToolInPanel={props.onOpenToolInPanel}
            onBuildPlan={props.onBuildPlan}
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

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const el = streamRef.current;
    if (!el) return;
    applyPin(reduceChatScrollPin(pinStateRef.current, { type: "force_pin" }));
    const resolved: ScrollBehavior =
      behavior === "smooth" && prefersReducedMotion() ? "auto" : behavior;
    const last = renderItems.length - 1;
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
      el.scrollTop = el.scrollHeight;
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
      if (isUnpinPointerEvent(e)) {
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
      if (isUnpinTouchGesture(y - touchLastY)) {
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
      if (isUnpinKeyEvent(e.key)) {
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
  }, [renderItems.length, useVirtualList]);

  useLayoutEffect(() => {
    scheduleFollow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.status, useVirtualList]);

  useLayoutEffect(() => {
    // 行数变化(append / 中间插入 tool_start / notice)不需要全量重测:
    // 全量重测会清空 itemSizeCache,已挂载行全部退回 estimate 高度,
    // 长行后的下一行仍按 estimate 定位,一屏以上时出现大面积行重叠。
    // tanstack 对新挂载行会在 ref 里实测高度,内容变化由内部
    // ResizeObserver 触发 resizeItem 校正,后续行 transform 随之重算;
    // 这里只需按 pin 状态跟随贴底。
    scheduleFollow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderItems.length, useVirtualList]);

  /**
   * assistant_end(status 从 streaming/retrying 切到 idle/error)行内容
   * 高度可能跳变(plain <pre> → <ReactMarkdown>、ThinkingBlock 开合)。
   * 收尾行始终挂载,tanstack 内部 ResizeObserver 会检测到该行尺寸变化
   * 并重算后续行,不需要全量重测(全量会清空 itemSizeCache,把未变化
   * 行的实测高度退回 estimate,反而造成长行后重叠)。
   */
  useLayoutEffect(() => {
    scheduleFollow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.status, useVirtualList]);

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
              const item = renderItems[virtualRow.index];
              if (!item) return null;
              const isLast = virtualRow.index === renderItems.length - 1;
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
                    // 不为气泡的操作头或溢出内容预留布局空间；按消息顺序
                    // 反向叠放，让上方气泡在发生尺寸误差时覆盖下方行。
                    zIndex: transcriptRowZIndex(
                      virtualRow.index,
                      renderItems.length,
                    ),
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
            {renderItems.map((item, idx) => {
              const isLast = idx === renderItems.length - 1;
              return (
                <div
                  key={item.id}
                  className="transcript-flow-row"
                  ref={isLast ? tailRef : undefined}
                  style={{
                    // Flow 行也保持与虚拟行一致的反向层叠顺序，避免短列表
                    // 与长列表在切换时出现不同的遮挡规则。
                    position: "relative",
                    zIndex: transcriptRowZIndex(idx, renderItems.length),
                  }}
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


