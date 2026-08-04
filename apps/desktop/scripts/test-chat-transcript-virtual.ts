/**
 * Transcript display helpers + guards against the old history-slice / plain degrade path.
 * Also locks the streaming→flow / idle→virtual layout contract.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDisplayableTranscriptItem } from "../shared/transcript/index.ts";
import type { ChatItem } from "../src/stores/chat-store";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

{
  const user: ChatItem = { kind: "user", id: "u1", text: "hi" };
  assert.equal(isDisplayableTranscriptItem(user, false), true);

  const emptyAssistant: ChatItem = {
    kind: "assistant",
    id: "a1",
    text: "  ",
    thinking: "",
    done: false,
  };
  assert.equal(isDisplayableTranscriptItem(emptyAssistant, false), false);
  assert.equal(isDisplayableTranscriptItem(emptyAssistant, true), false);

  const thinkingOnly: ChatItem = {
    kind: "assistant",
    id: "a2",
    text: "",
    thinking: "hmm",
    done: false,
  };
  assert.equal(isDisplayableTranscriptItem(thinkingOnly, false), false);
  assert.equal(isDisplayableTranscriptItem(thinkingOnly, true), true);

  const withText: ChatItem = {
    kind: "assistant",
    id: "a3",
    text: "hello",
    thinking: "",
    done: true,
  };
  assert.equal(isDisplayableTranscriptItem(withText, false), true);
}

{
  const transcript = readSrc("src/components/ChatTranscript.tsx");
  const virtualLib = readSrc("src/lib/chat-transcript-virtual.ts");
  // Both files together own virtualization behavior since the virtualizer
  // configuration was extracted to chat-transcript-virtual.ts.
  const combined = transcript + "\n" + virtualLib;
  assert.equal(combined.includes("history-virtualize-bar"), false);
  assert.equal(combined.includes("degradeMarkdown"), false);
  assert.equal(combined.includes("plainMarkdownCutoff"), false);
  assert.match(combined, /useVirtualizer/);
  assert.match(
    combined,
    /VIRTUALIZE_MIN_ITEMS/,
    "must gate virtualization on a min item count",
  );
  // Both idle and streaming paths must virtualize long transcripts. The exact
  // threshold can vary per mode (streaming uses a lower bar) but virtualization
  // must not be hard-disabled while streaming — that was the cause of the
  // chat-stuck-during-streaming regression. The streaming-mode constant is
  // named VIRTUALIZE_STREAMING_MIN_ITEMS; the idle constant is
  // VIRTUALIZE_MIN_ITEMS.
  assert.match(
    combined,
    /VIRTUALIZE_STREAMING_MIN_ITEMS/,
    "must define a streaming-mode virtualize threshold",
  );
  assert.match(
    transcript,
    /renderItems\.length\s*>=\s*\(\s*streaming\s*\?\s*VIRTUALIZE_STREAMING_MIN_ITEMS\s*:\s*VIRTUALIZE_MIN_ITEMS/,
    "virtualization must be mode-aware (streaming gets a lower bar)",
  );
  assert.match(
    transcript,
    /message-stream-flow/,
    "very short lists use document-flow layout",
  );

  const panel = readSrc("src/components/ChatPanel.tsx");
  assert.equal(panel.includes("degradeMarkdown"), false);

  const css = readSrc("src/styles/app.css");
  assert.equal(css.includes("history-virtualize-bar"), false);
  // Scrollport must stay block-level so the virtualizer can measure rows.
  const streamBlock = css.match(/\.message-stream\s*\{[^}]+\}/);
  assert.ok(streamBlock, "message-stream rule");
  assert.equal(
    /\bdisplay\s*:\s*flex\b/.test(streamBlock![0]!),
    false,
    "message-stream must not be display:flex (breaks virtual row range)",
  );

  const virtualRowBlock = css.match(/\.virtual-row\s*\{[^}]+\}/);
  assert.ok(virtualRowBlock, "virtual-row rule");
  assert.match(
    virtualRowBlock![0]!,
    /\bdisplay\s*:\s*flex\b/,
    "virtual-row must be flex so bubble align-self works",
  );

  const flowRowBlock = css.match(/\.transcript-flow-row\s*\{[^}]+\}/);
  assert.ok(flowRowBlock, "transcript-flow-row rule");
  assert.match(
    flowRowBlock![0]!,
    /\bdisplay\s*:\s*flex\b/,
    "flow rows must be flex so bubble align-self works",
  );

  const userBubbleBlock = css.match(/\.bubble-user\s*\{[^}]+\}/);
  assert.ok(userBubbleBlock, "bubble-user rule");
  assert.equal(
    /\balign-self\s*:\s*flex-end\b/.test(userBubbleBlock![0]!) ||
      /\bmargin-inline-start\s*:\s*auto\b/.test(userBubbleBlock![0]!),
    true,
    "bubble-user must right-align via align-self or margin-inline-start",
  );

  assert.match(
    css,
    /\.message-stream-flow[\s\S]*?\.transcript-flow-row:has/,
    "flow mode must compact consecutive collapsed tools",
  );

  // 操作头(撤回 / 重新生成)绝对定位在气泡下方且不占布局高度。
  // 设计约定是不为它额外推开下一行，而是让当前行通过层叠顺序覆盖下方。
  assert.doesNotMatch(
    css,
    /\.bubble:has\(\.bubble-head\)\s*\{[^}]*margin-bottom\s*:/,
    "bubbles with action heads must not reserve layout space",
  );
  assert.match(
    css,
    /\.bubble-head\s*\{[^}]*z-index:\s*[1-9]\d*/,
    "bubble action head must have an elevated stacking level",
  );
  const toolRule = css.match(/\.bubble-tool\s*\{[^}]+\}/);
  assert.ok(toolRule, "bubble-tool rule");
  assert.match(
    toolRule![0]!,
    /position:\s*relative[\s\S]*z-index:\s*[1-9]\d*/,
    "tool bubbles must stay above adjacent row content",
  );

  // 虚拟行不能裁剪测量盒外的紧凑工具条 / 气泡溢出内容。
  assert.match(
    virtualRowBlock![0]!,
    /overflow:\s*visible/,
    "virtual-row must allow tool cards and bubbles to overflow their measured box",
  );
  assert.doesNotMatch(
    virtualRowBlock![0]!,
    /overflow:\s*hidden/,
    "virtual-row must not clip tool cards or bubble action heads",
  );

  // transform 会让每个虚拟行成为独立层叠上下文,所以顺序必须设在行本身;
  // flow 与 virtual 两条路径都要复用同一套反向顺序。
  assert.match(
    transcript,
    /function transcriptRowZIndex\s*\(index:\s*number,\s*itemCount:\s*number\)/,
    "transcript rows must expose a deterministic stacking-order helper",
  );
  assert.match(
    transcript,
    /zIndex:\s*transcriptRowZIndex\([\s\S]*?virtualRow\.index/,
    "virtual rows must receive the stacking order on the transformed row",
  );
  assert.match(
    transcript,
    /zIndex:\s*transcriptRowZIndex\(idx,\s*renderItems\.length\)/,
    "flow rows must receive the same stacking order",
  );
}

console.log("test-chat-transcript-virtual ok");
