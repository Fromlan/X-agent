/**
 * ChatTranscript 滚动 follow 节流契约。
 *
 * 旧实现每次 text_delta 都跑 scheduleFollow + 双 rAF + 强制 scrollTop，
 * 流式期间用户拖滚动条会被强抢回去。新实现：
 *   - useLayoutEffect 不再依赖 props.items（只在 status / useVirtualList 切换时跑）。
 *   - followIfPinned 内部只用 1 次 rAF（不再嵌套 2 次）。
 *   - IntersectionObserver 观察尾节点决定是否跟到底。
 *
 * 测试只读源码做契约断言。
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

// 1. useLayoutEffect 不再依赖 props.items，避免每次 text_delta 触发。
{
  // 抓出包含 scheduleFollow 的 useLayoutEffect 块。
  const layoutBlock = transcript.match(
    /useLayoutEffect\(\(\)\s*=>\s*\{[^}]*scheduleFollow\(\)[^}]*\}, \[[^\]]+\]\)/s,
  );
  assert.ok(layoutBlock, "follow useLayoutEffect must exist");
  assert.equal(
    /props\.items/.test(layoutBlock[0]!),
    false,
    "follow useLayoutEffect must not depend on props.items (throttle per-delta)",
  );
  assert.match(
    layoutBlock[0]!,
    /props\.status/,
    "follow useLayoutEffect must depend on status edges",
  );
}

// 2. followIfPinned 不再嵌套 2 次 rAF。
{
  const followBody = transcript.match(
    /const followIfPinned\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*\};/,
  );
  assert.ok(followBody, "followIfPinned must exist");
  // 计算 rAF 出现次数：旧实现有 2 次嵌套；新实现应只剩 1 次。
  const rafCount = (followBody[0]!.match(/requestAnimationFrame/g) ?? []).length;
  assert.equal(
    rafCount,
    1,
    `followIfPinned must contain exactly 1 rAF (got ${rafCount})`,
  );
}

// 3. IntersectionObserver 存在并观察尾节点。
{
  assert.match(
    transcript,
    /IntersectionObserver/,
    "ChatTranscript must use IntersectionObserver for tail-node follow",
  );
  assert.match(
    transcript,
    /tailRef/,
    "ChatTranscript must expose a tailRef for the observer",
  );
}

console.log("test-chat-scroll-throttle: ok");