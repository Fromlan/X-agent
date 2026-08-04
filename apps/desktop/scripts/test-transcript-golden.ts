/**
 * Golden: branch restore and live-event replay should converge on the same
 * HistoryItem shape (kinds, text, toolName, done, userEntryId linkage).
 * Id generation may differ between paths — compare semantic fields only.
 */
import assert from "node:assert/strict";
import {
  applyAgentEvent,
  branchEntriesToHistory,
  type ChatItem,
  type BranchMessageEntry,
} from "../shared/transcript/index.ts";
import type { UiAgentEvent } from "../shared/ipc.ts";

const sampleMessages = [
  {
    role: "user",
    content: [{ type: "text", text: "列出文件" }],
    timestamp: 1,
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "好的" },
      {
        type: "toolCall",
        id: "tool-ls-1",
        name: "ls",
        arguments: { path: "." },
      },
    ],
    timestamp: 2,
  },
  {
    role: "toolResult",
    toolCallId: "tool-ls-1",
    toolName: "ls",
    content: [{ type: "text", text: "a.txt" }],
    timestamp: 3,
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "只有一个文件。" }],
    timestamp: 4,
  },
];

const branchEntries: BranchMessageEntry[] = sampleMessages.map((message, i) => ({
  type: "message",
  id: `entry-${i + 1}`,
  message,
}));

const fromBranch = branchEntriesToHistory(branchEntries);

const liveEvents: UiAgentEvent[] = [
  {
    type: "user_message",
    text: "列出文件",
    id: "entry-1",
    entryId: "entry-1",
  },
  {
    type: "assistant_start",
    messageId: "entry-2",
    userEntryId: "entry-1",
  },
  { type: "text_delta", messageId: "entry-2", delta: "好的" },
  { type: "assistant_end", messageId: "entry-2" },
  {
    type: "tool_start",
    toolCallId: "tool-ls-1",
    toolName: "ls",
    args: { path: "." },
  },
  {
    type: "tool_end",
    toolCallId: "tool-ls-1",
    toolName: "ls",
    result: "a.txt",
    isError: false,
  },
  {
    type: "assistant_start",
    messageId: "entry-4",
    userEntryId: "entry-1",
  },
  { type: "text_delta", messageId: "entry-4", delta: "只有一个文件。" },
  { type: "assistant_end", messageId: "entry-4" },
];

let fromLive: ChatItem[] = [];
for (const event of liveEvents) {
  fromLive = applyAgentEvent(fromLive, event);
}

function semanticKey(item: ChatItem): string {
  switch (item.kind) {
    case "user":
      return `user|${item.text}|${item.entryId ?? ""}`;
    case "assistant":
      return `assistant|${item.text}|${item.thinking ?? ""}|${item.done}|${item.userEntryId ?? ""}`;
    case "tool":
      return `tool|${item.toolName}|${item.done}|${JSON.stringify(item.result ?? null)}|${item.isError ?? false}`;
    case "system":
      return `system|${item.text}|${item.level ?? ""}`;
  }
}

assert.equal(fromBranch.length, fromLive.length, "item count");
for (let i = 0; i < fromBranch.length; i++) {
  assert.equal(
    semanticKey(fromBranch[i]!),
    semanticKey(fromLive[i]!),
    `semantic mismatch at ${i}: branch=${semanticKey(fromBranch[i]!)} live=${semanticKey(fromLive[i]!)}`,
  );
}

// Caps: tool args in restore use toolArgs (4k), not unbounded.
const hugeArgs = "x".repeat(5000);
const capped = branchEntriesToHistory([
  {
    type: "message",
    id: "u",
    message: {
      role: "user",
      content: [{ type: "text", text: "go" }],
    },
  },
  {
    type: "message",
    id: "a",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "t1",
          name: "bash",
          arguments: { cmd: hugeArgs },
        },
      ],
    },
  },
]);
const tool = capped.find((i) => i.kind === "tool");
assert.ok(tool && tool.kind === "tool");
const argsText =
  typeof tool.args === "string" ? tool.args : JSON.stringify(tool.args);
assert.ok(argsText.includes("截断"), "restore tool args should truncate");

// Auth-failure path: assistant message with empty content but a populated
// errorMessage must still land in history so the user can see what failed.
// Regression guard for the "401 ... invalid api key flashes for a second
// then disappears" bug (branch-mapper used to drop error-only assistants).
const errorEntries: BranchMessageEntry[] = [
  {
    type: "message",
    id: "u-1",
    message: { role: "user", content: [{ type: "text", text: "你好" }] },
  },
  {
    type: "message",
    id: "a-err",
    message: {
      role: "assistant",
      content: [],
      errorMessage: '401 {"error":{"message":"Authentication Fails"}}',
    },
  },
];
const errorHistory = branchEntriesToHistory(errorEntries);
const errorAssistant = errorHistory.find(
  (i) => i.kind === "assistant" && i.entryId === "a-err",
);
assert.ok(errorAssistant, "error-only assistant must survive branch-mapper");
assert.equal(
  errorAssistant?.isError,
  true,
  "error-only assistant must be flagged isError",
);
assert.ok(
  errorAssistant?.text.includes("Authentication Fails"),
  "errorMessage should populate assistant.text so history_replace keeps it",
);

// Sanity: an assistant with truly empty content (no text, no thinking, no
// toolCall, no error) still gets dropped — we only rescue error assistants.
const emptyEntries: BranchMessageEntry[] = [
  {
    type: "message",
    id: "u-x",
    message: { role: "user", content: [{ type: "text", text: "ping" }] },
  },
  {
    type: "message",
    id: "a-empty",
    message: { role: "assistant", content: [] },
  },
];
const emptyHistory = branchEntriesToHistory(emptyEntries);
assert.equal(
  emptyHistory.some((i) => i.kind === "assistant" && i.entryId === "a-empty"),
  false,
  "empty assistant with no error must still be dropped",
);

console.log("transcript golden ok");
