import assert from "node:assert/strict";
import {
  initialChatScrollPinState,
  isNearBottom,
  isScrollUnpinKey,
  isScrollable,
  isVerticalScrollbarPointer,
  isWheelUnpinDelta,
  reduceChatScrollPin,
  shouldFollow,
} from "../src/lib/chat-scroll-pin.ts";

// --- geometry helpers ---
assert.equal(
  isNearBottom({ scrollHeight: 1000, scrollTop: 920, clientHeight: 80 }),
  true,
);
assert.equal(
  isNearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 80 }),
  false,
);
assert.equal(
  isScrollable({ scrollHeight: 500, clientHeight: 400 }),
  true,
);
assert.equal(
  isScrollable({ scrollHeight: 400, clientHeight: 400 }),
  false,
);

assert.equal(isScrollUnpinKey("PageUp"), true);
assert.equal(isScrollUnpinKey("Home"), true);
assert.equal(isScrollUnpinKey("ArrowUp"), true);
assert.equal(isScrollUnpinKey("ArrowDown"), false);
assert.equal(isScrollUnpinKey("Enter"), false);

assert.equal(isWheelUnpinDelta(-40), true, "wheel up unpins");
assert.equal(isWheelUnpinDelta(40), false, "wheel down keeps pin");
assert.equal(isWheelUnpinDelta(0), false);

{
  const el = {
    clientWidth: 200,
    getBoundingClientRect: () => ({ left: 10, top: 20, bottom: 420 }),
  };
  assert.equal(isVerticalScrollbarPointer(el, 10 + 200, 100), true);
  assert.equal(isVerticalScrollbarPointer(el, 10 + 199, 100), false);
  assert.equal(isVerticalScrollbarPointer(el, 10 + 210, 10), false);
}

// --- pin + content grow → still follow ---
{
  let state = initialChatScrollPinState();
  assert.equal(shouldFollow(state), true);
  state = reduceChatScrollPin(state, { type: "programmatic_follow_start" });
  assert.equal(state.ignoreProgrammatic, true);
  assert.equal(shouldFollow(state), true);
  // Mid-layout !nearBottom must NOT unpin during programmatic follow
  state = reduceChatScrollPin(state, { type: "scroll", nearBottom: false });
  assert.equal(state.pinned, true);
  assert.equal(state.ignoreProgrammatic, true);
  state = reduceChatScrollPin(state, { type: "scroll", nearBottom: true });
  assert.equal(state.pinned, true);
  state = reduceChatScrollPin(state, { type: "programmatic_follow_end" });
  assert.equal(state.ignoreProgrammatic, false);
  assert.equal(shouldFollow(state), true);
}

// --- user wheel / intent unpins → follow no-op ---
{
  let state = initialChatScrollPinState();
  state = reduceChatScrollPin(state, { type: "user_intent_unpin" });
  assert.equal(state.pinned, false);
  assert.equal(state.ignoreProgrammatic, false);
  assert.equal(shouldFollow(state), false);
  // Content grow must not re-pin without force
  state = reduceChatScrollPin(state, { type: "programmatic_follow_start" });
  assert.equal(state.ignoreProgrammatic, false);
  assert.equal(shouldFollow(state), false);
}

// --- normal scroll updates pin when not ignoring ---
{
  let state = initialChatScrollPinState();
  state = reduceChatScrollPin(state, { type: "scroll", nearBottom: false });
  assert.equal(state.pinned, false);
  state = reduceChatScrollPin(state, { type: "scroll", nearBottom: true });
  assert.equal(state.pinned, true);
}

// --- jump / force pin re-pins ---
{
  let state = reduceChatScrollPin(initialChatScrollPinState(), {
    type: "user_intent_unpin",
  });
  assert.equal(shouldFollow(state), false);
  state = reduceChatScrollPin(state, { type: "force_pin" });
  assert.equal(state.pinned, true);
  assert.equal(state.ignoreProgrammatic, true);
  assert.equal(shouldFollow(state), true);
}

console.log("test-chat-scroll-pin: ok");
