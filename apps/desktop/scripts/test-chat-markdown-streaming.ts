/**
 * MarkdownBody streaming-degrade contract.
 *
 * 流式输出期间 AssistantBubble 必须把 useMarkdown 置 false，让
 * MarkdownBody 直接渲染 plain `<pre>` 而不是 react-markdown + remarkGfm。
 * assistant_end（done=true）时 useMarkdown 切 true，触发一次完整解析定型。
 *
 * 测试只读源码做契约断言，避免引入 RTL 依赖。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const markdown = readFileSync(
  join(root, "src/components/MarkdownBody.tsx"),
  "utf8",
);
const transcript = readFileSync(
  join(root, "src/components/ChatTranscript.tsx"),
  "utf8",
);

{
  // MarkdownBody 暴露 useMarkdown prop。
  assert.match(
    markdown,
    /useMarkdown\?: boolean/,
    "MarkdownBody must declare useMarkdown prop",
  );
  assert.match(
    markdown,
    /plain \|\| !useMarkdown/,
    "MarkdownBody must short-circuit to plain <pre> when useMarkdown is false",
  );
}

{
  // AssistantBubble 调用时把 useMarkdown 绑到 props.item.done。
  // AssistantBubble 已抽到 src/components/chat/bubbles.tsx,ChatTranscript 顶层薄壳只组合。
  const transcript = readFileSync(
    join(root, "src/components/ChatTranscript.tsx"),
    "utf8",
  );
  const bubbles = readFileSync(
    join(root, "src/components/chat/bubbles.tsx"),
    "utf8",
  );
  const combined = transcript + "\n" + bubbles;
  assert.match(
    combined,
    /useMarkdown=\{props\.item\.done\}/,
    "AssistantBubble must pass useMarkdown={done} so streaming messages stay plain",
  );
}

{
  // .markdown-plain CSS 必须存在（已存在，但锁定契约）。
  const css = readFileSync(join(root, "src/styles/app.css"), "utf8");
  assert.match(
    css,
    /\.markdown-plain\s*\{/,
    "app.css must define .markdown-plain for the streaming fallback",
  );
}

console.log("test-chat-markdown-streaming: ok");