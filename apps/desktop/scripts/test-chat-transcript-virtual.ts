/**
 * Transcript display helpers + guards against the old history-slice / plain degrade path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDisplayableTranscriptItem } from "../src/lib/chat-transcript-items.ts";
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
  assert.equal(transcript.includes("VIRTUALIZE_THRESHOLD"), false);
  assert.equal(transcript.includes("history-virtualize-bar"), false);
  assert.equal(transcript.includes("degradeMarkdown"), false);
  assert.equal(transcript.includes("plainMarkdownCutoff"), false);
  assert.match(transcript, /useVirtualizer/);

  const panel = readSrc("src/components/ChatPanel.tsx");
  assert.equal(panel.includes("degradeMarkdown"), false);

  const css = readSrc("src/styles/app.css");
  assert.equal(css.includes("history-virtualize-bar"), false);
}

console.log("test-chat-transcript-virtual ok");
