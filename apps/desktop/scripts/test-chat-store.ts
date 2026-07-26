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

console.log("test-chat-store: ok");
