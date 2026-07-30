/** Stick-to-bottom pin state for the chat transcript scroll container. */

export const PIN_THRESHOLD_PX = 80;

export type ChatScrollPinState = {
  pinned: boolean;
  /** True while we are programmatically scrolling to the bottom. */
  ignoreProgrammatic: boolean;
};

export type ChatScrollPinEvent =
  | { type: "user_intent_unpin" }
  | { type: "force_pin" }
  | { type: "programmatic_follow_start" }
  | { type: "programmatic_follow_end" }
  | { type: "scroll"; nearBottom: boolean };

export function initialChatScrollPinState(): ChatScrollPinState {
  return { pinned: true, ignoreProgrammatic: false };
}

export function reduceChatScrollPin(
  state: ChatScrollPinState,
  event: ChatScrollPinEvent,
): ChatScrollPinState {
  switch (event.type) {
    case "user_intent_unpin":
      return { pinned: false, ignoreProgrammatic: false };
    case "force_pin":
      return { pinned: true, ignoreProgrammatic: true };
    case "programmatic_follow_start":
      if (!state.pinned) return state;
      return { ...state, ignoreProgrammatic: true };
    case "programmatic_follow_end":
      return { ...state, ignoreProgrammatic: false };
    case "scroll":
      // While following programmatically, ignore scroll geometry — a mid-layout
      // frame often reports !nearBottom and must not be treated as user unpin.
      if (state.ignoreProgrammatic) {
        return state;
      }
      return { ...state, pinned: event.nearBottom };
    default:
      return state;
  }
}

export function shouldFollow(state: ChatScrollPinState): boolean {
  return state.pinned;
}

export function distanceFromBottom(metrics: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): number {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
}

export function isNearBottom(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = PIN_THRESHOLD_PX,
): boolean {
  return distanceFromBottom(metrics) <= threshold;
}

export function isScrollable(metrics: {
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return metrics.scrollHeight > metrics.clientHeight + 1;
}

/** True when a pointer hits the vertical scrollbar gutter of `el`. */
export function isVerticalScrollbarPointer(
  el: {
    getBoundingClientRect(): { left: number; top: number; bottom: number };
    clientWidth: number;
  },
  clientX: number,
  clientY: number,
): boolean {
  const rect = el.getBoundingClientRect();
  if (clientY < rect.top || clientY > rect.bottom) return false;
  return clientX >= rect.left + el.clientWidth;
}

/**
 * Wheel / trackpad delta that means "scroll toward older messages" (up).
 * Positive deltaY is typically scroll down (toward latest).
 */
export function isWheelUnpinDelta(deltaY: number): boolean {
  return deltaY < 0;
}

const UNPIN_KEYS = new Set(["PageUp", "Home", "ArrowUp"]);

export function isScrollUnpinKey(key: string): boolean {
  return UNPIN_KEYS.has(key);
}
