/**
 * ChatTranscript 虚拟列表缓存契约。
 *
 * 长对话(超过一屏 / 达到虚拟化阈值)后,流式追加、assistant 收尾、
 * 中间插入 tool 行等路径都出现过"行重叠、所有消息显示混乱"的问题。
 * 根因是这两个 useLayoutEffect 调用全量 virtualizer.measure():
 * tanstack 的 measure() 会清空整个 itemSizeCache,已挂载行全部退回
 * estimate 高度,长行之后的下一行仍按 estimate 定位,重叠直到该行
 * 卸载重挂才恢复。
 *
 * 正确姿势:新挂载行由 ref 实测,已挂载行内容变化由 tanstack 内部
 * ResizeObserver 触发 resizeItem 校正,均不需要全量 measure()。
 * 本测试锁住"ChatTranscript 不得调用 virtualizer.measure()"。
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

// 1. 全量 measure() 是根因,任何路径都不得出现。
{
  assert.doesNotMatch(
    transcript,
    /virtualizer\.measure\(\)/,
    "ChatTranscript must not call virtualizer.measure() — it nukes itemSizeCache and causes row overlap",
  );
}

// 2. 定向 measureElement(ref)仍然允许(新挂载行实测高度)。
{
  assert.match(
    transcript,
    /virtualizer\.measureElement/,
    "per-row measureElement refs are the supported measurement path",
  );
}

// 3. renderItems.length 变化的 layout effect:只 scheduleFollow,不 measure,
//    且不能对 flow 模式早退(flow 也需要跟随)。
{
  const itemsEffect = transcript.match(
    /useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[renderItems\.length,\s*useVirtualList]\)/,
  );
  assert.ok(itemsEffect, "items-length useLayoutEffect must exist");
  assert.match(
    itemsEffect[0]!,
    /scheduleFollow\(\)/,
    "items-length effect must scheduleFollow",
  );
  assert.doesNotMatch(
    itemsEffect[0]!,
    /virtualizer\.measure\(\)/,
    "items-length effect must not call virtualizer.measure()",
  );
  assert.doesNotMatch(
    itemsEffect[0]!,
    /if\s*\(\s*!useVirtualList\s*\)\s*return/,
    "items-length effect must not short-circuit on !useVirtualList (flow mode also needs follow)",
  );
}

// 4. assistant_end / status 边界的 layout effect:同样只 scheduleFollow。
{
  const statusEffect = transcript.match(
    /assistant_end[\s\S]*?useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]*?scheduleFollow\(\)[\s\S]*?\},\s*\[props\.status,\s*useVirtualList\]\)/,
  );
  assert.ok(statusEffect, "status-edge useLayoutEffect must exist");
  assert.doesNotMatch(
    statusEffect[0]!,
    /virtualizer\.measure\(\)/,
    "status-edge effect must not call virtualizer.measure()",
  );
}

console.log("test-chat-virtual-cache: ok");
