/**
 * ChatTranscript virtualizer 配置 —— 阈值常量与 useChatVirtualizerConfig hook。
 * 抽离避免 ChatTranscript 主文件塞满 virtualizer 调参细节。
 */
import { useMemo, useRef } from "react";
import {
  useVirtualizer,
  type Virtualizer,
  type ScrollToOptions,
} from "@tanstack/react-virtual";

/** Estimated row height before measure (px); includes inter-row gap. */
export const ESTIMATE_ROW_PX = 72;
/** Streaming estimate: markdown is still growing + tool cards can be tall. */
export const ESTIMATE_ROW_PX_STREAMING = 120;
export const ROW_GAP_PX = 16;
const OVERSCAN = 8;
/** Overscan during streaming — larger to mask measure lag while content races. */
const OVERSCAN_STREAMING = 12;
/**
 * Absolute virtual rows mis-measure while content height races (streaming
 * text / thinking / tools), especially in a narrow pane — items overlap.
 * Use document flow until idle with a long transcript.
 */
const VIRTUALIZE_MIN_ITEMS = 48;
/** Lower bar while streaming so we virtualize sooner. */
const VIRTUALIZE_STREAMING_MIN_ITEMS = 24;

/**
 * Re-export 阈值常量供 ChatTranscript.tsx 在源码层面保留契约(测试 source-grep
 * 期望 VIRTUALIZE_MIN_ITEMS 与 streaming ? : 表达式同时存在于 ChatTranscript)。
 */
export { VIRTUALIZE_MIN_ITEMS, VIRTUALIZE_STREAMING_MIN_ITEMS };

export interface ChatVirtualizerConfig {
  estimateSize: () => number;
  overscan: number;
  /** Use virtualizer vs document flow based on count + streaming. */
  shouldVirtualize: boolean;
}

export interface UseChatVirtualizerConfigOpts {
  count: number;
  streaming: boolean;
}

/** 派生虚拟化阈值配置(estimate / overscan / 是否启用)。 */
export function useChatVirtualizerConfig(
  opts: UseChatVirtualizerConfigOpts,
): ChatVirtualizerConfig {
  const { count, streaming } = opts;
  return useMemo(
    () => ({
      estimateSize: () =>
        streaming ? ESTIMATE_ROW_PX_STREAMING : ESTIMATE_ROW_PX,
      overscan: streaming ? OVERSCAN_STREAMING : OVERSCAN,
      shouldVirtualize:
        count >= (streaming ? VIRTUALIZE_STREAMING_MIN_ITEMS : VIRTUALIZE_MIN_ITEMS),
    }),
    [count, streaming],
  );
}

/**
 * 创建 ChatTranscript 的 virtualizer 实例。
 * 必须在 React 组件渲染顶层调用(hook 规则)。
 */
export function useChatTranscriptVirtualizer(opts: {
  config: ChatVirtualizerConfig;
  count: number;
  scrollElement: HTMLElement | null;
  getItemKey: (index: number) => string | number;
}): Virtualizer<HTMLElement, Element> {
  const { config, count, scrollElement, getItemKey } = opts;
  return useVirtualizer({
    count: config.shouldVirtualize ? count : 0,
    getScrollElement: () => scrollElement,
    estimateSize: config.estimateSize,
    overscan: config.overscan,
    getItemKey,
  });
}

export type { ScrollToOptions };