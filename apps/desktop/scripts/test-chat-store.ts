import {
  applyAgentEvent,
  createEmptyState,
} from "../src/stores/chat-store";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let items = createEmptyState();
items = applyAgentEvent(items, { type: "user_message", text: "hi", id: "u1" });
items = applyAgentEvent(items, { type: "user_message", text: "hi", id: "u2" });
assert(items.length === 2, "identical text with different ids must both appear");

items = applyAgentEvent(items, { type: "assistant_start", messageId: "a1" });
items = applyAgentEvent(items, { type: "text_delta", messageId: "a1", delta: "hel" });
items = applyAgentEvent(items, { type: "text_delta", messageId: "a1", delta: "lo" });
items = applyAgentEvent(items, {
  type: "assistant_end",
  messageId: "a1",
  isError: false,
});
const asst = items.find((i) => i.kind === "assistant" && i.id === "a1");
assert(asst?.kind === "assistant" && asst.text === "hello" && asst.done, "assistant merge");

// Mid-stream regenerate fallback: entryId is not threaded through streaming
// events, but the renderer should still expose the preceding user entry id
// so the regenerate button can act on the latest user message.
assert(
  asst?.kind === "assistant" && asst.userEntryId === "u2",
  "assistant should backfill userEntryId from the preceding user message",
);

items = applyAgentEvent(items, {
  type: "notice",
  text: "model fallback",
  level: "warn",
});
assert(items.some((i) => i.kind === "system"), "notice becomes system");

items = applyAgentEvent(items, {
  type: "history_replace",
  items: [{ kind: "user", id: "x", text: "reset" }],
});
assert(items.length === 1 && items[0]!.kind === "user", "history_replace");

// Streaming + history_replace + new user_message:
// After history_replace wipes the items, a new user message must be appended
// and the next assistant_start must backfill userEntryId from the new user.
items = applyAgentEvent(items, { type: "user_message", text: "next", id: "u3" });
items = applyAgentEvent(items, { type: "assistant_start", messageId: "a2" });
items = applyAgentEvent(items, { type: "text_delta", messageId: "a2", delta: "ok" });
items = applyAgentEvent(items, {
  type: "assistant_end",
  messageId: "a2",
  isError: false,
});
const a2 = items.find((i) => i.kind === "assistant" && i.id === "a2");
assert(
  a2?.kind === "assistant" && a2.text === "ok" && a2.done,
  "assistant after history_replace should still accumulate",
);
assert(
  a2?.kind === "assistant" && a2.userEntryId === "u3",
  "assistant after history_replace should backfill userEntryId from the new user",
);
assert(
  items.filter((i) => i.kind === "user").length === 2,
  "history_replace should have left the synthetic user 'x' and the new user 'u3'",
);
assert(
  items.filter((i) => i.kind === "user").map((i) => i.id).join(",") === "x,u3",
  "user order should be preserved (history_replace payload, then user_message)",
);

// usage_update / compaction events must not alter the transcript
items = applyAgentEvent(items, {
  type: "usage_update",
  usage: {
    tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
    cost: 0,
    context: null,
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 0,
  },
});
assert(items.length === 3, "usage_update leaves items unchanged");
items = applyAgentEvent(items, {
  type: "compaction_start",
  reason: "manual",
});
assert(items.length === 3, "compaction_start leaves items unchanged");

console.log("test-chat-store: ok");
