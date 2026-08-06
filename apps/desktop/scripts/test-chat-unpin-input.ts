/**
 * chat-unpin-input 行为测试:输入事件 → 贴底意图的纯函数判定。
 * 与 test-chat-scroll-pin.ts 同款方式手动跑(未接入 npm test 链):
 *   npx tsx --tsconfig tsconfig.web.json scripts/test-chat-unpin-input.ts
 *
 * 覆盖:wheel 向上滚 unpin / 向下滚不 unpin;PageUp/Home/ArrowUp unpin /
 * 其它键不 unpin;touch 上滑 8px 阈值边界(7.9 / 8.0 / 8.1);总入口分发。
 * 另用 source-grep 锁住 ChatTranscript 必须经由本模块判定、不得内联阈值。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isUnpinKeyEvent,
  isUnpinPointerEvent,
  isUnpinTouchGesture,
  shouldUnpinFromInput,
  UNPIN_TOUCH_DELTA_PX,
} from "../src/lib/chat-unpin-input.ts";

// --- wheel / pointer:向上滚 unpin,向下滚与静止不 unpin ---
assert.equal(isUnpinPointerEvent({ deltaY: -40, type: "wheel" }), true);
assert.equal(isUnpinPointerEvent({ deltaY: -1, type: "wheel" }), true);
assert.equal(isUnpinPointerEvent({ deltaY: 40, type: "wheel" }), false);
assert.equal(isUnpinPointerEvent({ deltaY: 0, type: "wheel" }), false);
assert.equal(
  isUnpinPointerEvent({ deltaY: -40, type: "touchpad" }),
  true,
  "type 不影响判定,只作签名限定",
);

// --- keyboard:PageUp/Home/ArrowUp unpin,其它键不 unpin ---
assert.equal(isUnpinKeyEvent("PageUp"), true);
assert.equal(isUnpinKeyEvent("Home"), true);
assert.equal(isUnpinKeyEvent("ArrowUp"), true);
assert.equal(isUnpinKeyEvent("ArrowDown"), false);
assert.equal(isUnpinKeyEvent("PageDown"), false);
assert.equal(isUnpinKeyEvent("End"), false);
assert.equal(isUnpinKeyEvent("Enter"), false);
assert.equal(isUnpinKeyEvent("Escape"), false);
assert.equal(isUnpinKeyEvent(" "), false);

// --- touch:上滑超过阈值 unpin,边界值保持组件原 `> 8` 严格大于语义 ---
assert.equal(UNPIN_TOUCH_DELTA_PX, 8, "touch 阈值必须仍为 8px");
assert.equal(isUnpinTouchGesture(8.1), true, "8.1px 上滑必须 unpin");
assert.equal(isUnpinTouchGesture(8.0), false, "恰好 8px 不 unpin(严格大于)");
assert.equal(isUnpinTouchGesture(7.9), false, "7.9px 不 unpin");
assert.equal(isUnpinTouchGesture(100), true, "大幅度上滑 unpin");
assert.equal(isUnpinTouchGesture(0), false, "无位移不 unpin");
assert.equal(isUnpinTouchGesture(-5), false, "下滑不 unpin");
assert.equal(isUnpinTouchGesture(-100), false, "大幅度下滑不 unpin");

// --- 总入口:三种输入分发到对应判定 ---
assert.equal(
  shouldUnpinFromInput({ kind: "wheel", deltaY: -40 }),
  true,
  "总入口 wheel 向上滚 unpin",
);
assert.equal(
  shouldUnpinFromInput({ kind: "wheel", deltaY: 40 }),
  false,
  "总入口 wheel 向下滚不 unpin",
);
assert.equal(shouldUnpinFromInput({ kind: "key", key: "PageUp" }), true);
assert.equal(shouldUnpinFromInput({ kind: "key", key: "ArrowDown" }), false);
assert.equal(shouldUnpinFromInput({ kind: "touch", dy: 9 }), true);
assert.equal(shouldUnpinFromInput({ kind: "touch", dy: 8 }), false);
assert.equal(shouldUnpinFromInput({ kind: "touch", dy: 7.9 }), false);

// --- source-grep 契约:组件判定必须经由本模块,不得内联阈值或绕过 ---
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const transcript = readFileSync(
    join(root, "src/components/ChatTranscript.tsx"),
    "utf8",
  );
  assert.match(
    transcript,
    /isUnpinPointerEvent/,
    "wheel 判定必须走 chat-unpin-input 纯函数",
  );
  assert.match(
    transcript,
    /isUnpinKeyEvent/,
    "key 判定必须走 chat-unpin-input 纯函数",
  );
  assert.match(
    transcript,
    /isUnpinTouchGesture/,
    "touch 判定必须走 chat-unpin-input 纯函数",
  );
  assert.doesNotMatch(
    transcript,
    /y - touchLastY > 8/,
    "8px 阈值不得内联在组件里",
  );
  assert.doesNotMatch(
    transcript,
    /isWheelUnpinDelta\(e\.deltaY\)/,
    "wheel 判定不得绕过 chat-unpin-input",
  );
  assert.doesNotMatch(
    transcript,
    /isScrollUnpinKey\(e\.key\)/,
    "key 判定不得绕过 chat-unpin-input",
  );
}

console.log("test-chat-unpin-input: ok");
