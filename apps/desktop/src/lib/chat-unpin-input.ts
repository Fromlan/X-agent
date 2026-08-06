/**
 * ChatTranscript 输入事件 → "用户想取消贴底"意图的纯函数判定层。
 *
 * 组件里 7 组原生事件监听把"几何 / 键盘语义 → 业务规则"硬编码成不可测逻辑
 * (wheel 向上滚、PageUp/Home/ArrowUp、touch 上滑 8px)。本模块把可纯函数化的
 * 判定提升为独立模块,组件只保留事件绑定与调用编排。
 * wheel / keyboard 判定直接委托 chat-scroll-pin 的既有谓词,不复制实现。
 */
import { isScrollUnpinKey, isWheelUnpinDelta } from "./chat-scroll-pin";

/** Touch 上滑判定阈值(px):超过该距离视为用户主动向上浏览,取消贴底。 */
export const UNPIN_TOUCH_DELTA_PX = 8;

/**
 * Wheel / 滚轮事件判定:deltaY < 0(向上滚)表示用户想看旧消息,取消贴底。
 * `type` 字段保留在签名里以限定只对 wheel 类 pointer 事件生效。
 */
export function isUnpinPointerEvent(e: {
  deltaY: number;
  type: string;
}): boolean {
  return isWheelUnpinDelta(e.deltaY);
}

/** 键盘事件判定:PageUp / Home / ArrowUp 是向上浏览键,取消贴底。 */
export function isUnpinKeyEvent(key: string): boolean {
  return isScrollUnpinKey(key);
}

/**
 * Touch 手势判定:手指上滑超过 UNPIN_TOUCH_DELTA_PX 视为向上浏览,取消贴底。
 * dy > 0 表示上滑;严格大于阈值(与组件原 `> 8` 语义一致)。
 */
export function isUnpinTouchGesture(dy: number): boolean {
  return dy > UNPIN_TOUCH_DELTA_PX;
}

/** 归一化的输入来源:wheel / key / touch 三种事件。 */
export type UnpinInput =
  | { kind: "wheel"; deltaY: number }
  | { kind: "key"; key: string }
  | { kind: "touch"; dy: number };

/** 总入口:归一化 wheel / key / touch 输入,判定是否应取消贴底。 */
export function shouldUnpinFromInput(input: UnpinInput): boolean {
  switch (input.kind) {
    case "wheel":
      return isUnpinPointerEvent({ deltaY: input.deltaY, type: "wheel" });
    case "key":
      return isUnpinKeyEvent(input.key);
    case "touch":
      return isUnpinTouchGesture(input.dy);
  }
}
