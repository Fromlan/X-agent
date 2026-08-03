/**
 * ChatTranscript 虚拟列表底部路由契约。
 *
 * 旧实现两项 root cause:
 *   1. items.length 变化触发 virtualizer.measure() 清空全部 itemSizeCache,
 *      totalSize 系统性低估 → 用户滑到"底"附近底部持续后退。
 *   2. virtual 路径走 virtualizer.scrollToIndex(last, { align: "end" }),
 *      该调用会写 scrollState 并 scheduleScrollReconcile(),5 秒内每帧
 *      强写 scrollTop,与 rAF 内裸写 el.scrollTop 互相抢。
 *
 * 修复后:
 *   - virtual 路径统一走 virtualizer.scrollToOffset(bottomOffset, { behavior })
 *   - items.length 变化改 scheduleFollow(),不再 measure()
 *   - scrollToBottom / followIfPinned 内部都路由至统一 helper
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const transcript = readFileSync(
  join(root, "src/components/ChatTranscript.tsx"),
  "utf8",
);

// 1. R1 旧契约是"全局禁 measure()",但容器尺寸/主题/切窗口场景
//    需要 measure() 重测所有行(itemSizeCache 与真实行高脱节)。
//    新契约改成:items-length effect 内不能 measure(),resize 路径允许。
//    items-length effect 的 doesNotMatch 在 #4 段已经锁住。
//
// (R1 修复要点保留为注释,实际断言见 #4 段。)
// {
//   assert.doesNotMatch(
//     transcript,
//     /virtualizer\.measure\(\)/,
//     "ChatTranscript must not call full virtualizer.measure() — it nukes itemSizeCache",
//   );
// }

// 2. scrollToIndex 必须消失,否则会启动 5 秒 reconcile 循环。
{
  assert.doesNotMatch(
    transcript,
    /virtualizer\.scrollToIndex\(/,
    "ChatTranscript must not call virtualizer.scrollToIndex — it kicks off a 5s reconcile loop",
  );
}

// 3. 虚拟模式路由必须走 scrollToOffset。
{
  assert.match(
    transcript,
    /virtualizer\.scrollToOffset\(/,
    "virtual bottom routing must use virtualizer.scrollToOffset",
  );
}

// 4. items.length effect 必须改为 scheduleFollow,不能再 measure。
{
  // 提取以 [displayItems.length, useVirtualList] 为依赖的 useLayoutEffect 块。
  // 注意:此 pattern 在源文件中出现两次(status edge 和 items.length),
  // 我们只关心依赖里包含 displayItems.length 的那一段。
  const itemsEffect = transcript.match(
    /useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[displayItems\.length,\s*useVirtualList\]\)/,
  );
  assert.ok(itemsEffect, "items-length useLayoutEffect must exist");
  assert.match(
    itemsEffect[0]!,
    /scheduleFollow\(\)/,
    "items-length effect must scheduleFollow, not measure",
  );
  assert.doesNotMatch(
    itemsEffect[0]!,
    /virtualizer\.measure\(\)/,
    "items-length effect must not call virtualizer.measure()",
  );
  // 之前存在 if (!useVirtualList) return; 早退,会跳过 flow 模式的跟随,
  // 新实现应删除该早退(R4 要求 items 增长在两种模式都触发跟随)。
  assert.doesNotMatch(
    itemsEffect[0]!,
    /if\s*\(\s*!useVirtualList\s*\)\s*return/,
    "items-length effect must not short-circuit on !useVirtualList (flow mode also needs follow)",
  );
}

// 5. 提取 scrollToBottom 函数体并断言走统一 helper。
{
  const body = transcript.match(
    /const scrollToBottom\s*=\s*\(\s*behavior\s*:\s*ScrollBehavior\s*\)\s*=>\s*\{[\s\S]*?\n\s*\};/,
  );
  assert.ok(body, "scrollToBottom function body must exist");
  assert.match(
    body[0]!,
    /scrollElementToBottom\(el,\s*resolved\)/,
    "scrollToBottom must route via scrollElementToBottom(el, resolved)",
  );
  // rAF 收尾帧也必须走统一 helper。
  assert.match(
    body[0]!,
    /requestAnimationFrame\([\s\S]*?scrollElementToBottom\(el,\s*"auto"\)/,
    "scrollToBottom follow-up frame must also route via scrollElementToBottom(el, 'auto')",
  );
  // 显式 force_pin 必须仍先于滚动发出(不能被 helper 吞掉)。
  assert.match(
    body[0]!,
    /reduceChatScrollPin\(pinStateRef\.current,\s*\{\s*type:\s*"force_pin"\s*\}\)/,
    "scrollToBottom must still dispatch force_pin before scrolling",
  );
  // reduced-motion 降级逻辑必须保留。
  assert.match(
    body[0]!,
    /prefersReducedMotion\(\)/,
    "scrollToBottom must still respect prefersReducedMotion",
  );
}

// 6. 提取 followIfPinned 函数体并断言:1 rAF + 走统一 helper + unpin 闸门。
{
  const body = transcript.match(
    /const followIfPinned\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*\};/,
  );
  assert.ok(body, "followIfPinned function body must exist");
  // 唯一 rAF 契约(由 test-chat-scroll-throttle.ts 也锁住,这里再核一次)。
  const rafCount = (body[0]!.match(/requestAnimationFrame/g) ?? []).length;
  assert.equal(
    rafCount,
    1,
    `followIfPinned must contain exactly 1 rAF (got ${rafCount})`,
  );
  assert.match(
    body[0]!,
    /scrollElementToBottom\(el,\s*"auto"\)/,
    "followIfPinned rAF must route via scrollElementToBottom(el, 'auto')",
  );
  // 之前的 el.scrollTop = el.scrollHeight 必须消失。
  assert.doesNotMatch(
    body[0]!,
    /el\.scrollTop\s*=\s*el\.scrollHeight/,
    "followIfPinned must not bypass virtualizer with raw scrollTop write",
  );
  // 保留 unpin 闸门(用户 unpin 后不抢滚动)。
  assert.match(
    body[0]!,
    /if\s*\(\s*!shouldFollow\(pinStateRef\.current\)\s*\)/,
    "followIfPinned must keep its unpin gate (no-op after user unpin)",
  );
}

// 7. 提取 scrollElementToBottom helper 块并断言几何正确。
{
  const body = transcript.match(
    /const scrollElementToBottom\s*=\s*\([\s\S]*?\)\s*=>\s*\{[\s\S]*?\n\s*\};/,
  );
  assert.ok(body, "scrollElementToBottom helper must exist");
  assert.match(
    body[0]!,
    /el\.scrollHeight\s*-\s*el\.clientHeight/,
    "bottom offset must be derived from current scroll DOM geometry",
  );
  assert.match(
    body[0]!,
    /Math\.max\(\s*0\s*,/,
    "bottom offset must clamp non-negative (short content)",
  );
  // virtual 分支必须显式走 scrollToOffset。
  assert.match(
    body[0]!,
    /useVirtualList[\s\S]*?scrollToOffset/,
    "scrollElementToBottom virtual branch must call scrollToOffset",
  );
  // 兜底保留 DOM scrollTo / scrollTop 路径(虚拟模式被关时仍可用)。
  assert.match(
    body[0]!,
    /el\.scrollTo\(\s*\{\s*top:\s*bottomOffset\s*,\s*behavior:\s*"smooth"\s*\}\s*\)/,
    "scrollElementToBottom non-virtual smooth branch must use el.scrollTo",
  );
}

// 8. ChatTranscript 顶层必须显式声明 ScrollBehavior 收窄或保留 ScrollBehavior 用法。
// (避免有人把 reduced-motion 退化拆掉导致 smooth 漏掉。)
// 这里只断言 helper 接收 (el, behavior) 且 behavior 标注 ScrollBehavior。
{
  // helper 在源码里是跨行定义的;用 [\s\S]*? 跨行更稳定。
  const helper = transcript.match(
    /const\s+scrollElementToBottom\s*=\s*\([\s\S]*?HTMLElement[\s\S]*?ScrollBehavior[\s\S]*?\)/,
  );
  assert.ok(
    helper,
    "scrollElementToBottom must accept (el: HTMLElement, behavior: ScrollBehavior)",
  );
}

// 9. 容器尺寸 / 窗口 / 主题 / 切回前台必须触发 virtualizer 重测
// (后续 commit 扩:这部分断言紧随其后追加)。
/* (resize 重测断言见后续 commit) */

console.log("test-chat-scroll-virtual-routing: ok");
