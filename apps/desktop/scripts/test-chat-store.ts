import {
  appendPendingUser,
  applyAgentEvent,
  createEmptyState,
  isPendingUserId,
  makePendingUserId,
  removePendingUser,
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
  type: "notice",
  text: "已进入 Plan 模式",
  replaceKey: "session_mode",
});
items = applyAgentEvent(items, {
  type: "notice",
  text: "已切换到 Agent 模式。",
  replaceKey: "session_mode",
});
const modeNotices = items.filter(
  (i) => i.kind === "system" && i.replaceKey === "session_mode",
);
assert(modeNotices.length === 1, "same replaceKey should replace prior notice");
assert(
  modeNotices[0]!.kind === "system" &&
    modeNotices[0]!.text === "已切换到 Agent 模式。",
  "replaced notice text",
);

items = applyAgentEvent(items, {
  type: "notice",
  text: "已切换模型：a/b",
  replaceKey: "model",
});
items = applyAgentEvent(items, {
  type: "notice",
  text: "已切换模型：c/d",
  replaceKey: "model",
});
assert(
  items.filter((i) => i.kind === "system" && i.replaceKey === "model").length ===
    1,
  "model notices should replace within their key",
);
assert(
  items.filter((i) => i.kind === "system").length === 3,
  "fallback + session_mode + model should coexist as separate keys",
);

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

// Optimistic send: pending bubble must be replaced by the real user_message
// (not duplicated), and dropped on send failure.
{
  let pending = createEmptyState();
  const pendingId = makePendingUserId();
  assert(isPendingUserId(pendingId), "pending id prefix");
  pending = appendPendingUser(pending, "typed now", pendingId);
  assert(
    pending.length === 1 &&
      pending[0]!.kind === "user" &&
      pending[0]!.id === pendingId &&
      pending[0]!.text === "typed now",
    "appendPendingUser",
  );
  pending = applyAgentEvent(pending, {
    type: "user_message",
    text: "typed now",
    id: "u-real",
    entryId: "entry-1",
  });
  // B7: 保持 pending 占位 id（避免 virtual-row remount 闪烁），entryId 更新。
  assert(
    pending.length === 1 &&
      pending[0]!.kind === "user" &&
      pending[0]!.id === pendingId &&
      pending[0]!.entryId === "entry-1",
    "real user_message should replace pending bubble in place",
  );

  let failed = appendPendingUser(createEmptyState(), "nope", pendingId);
  failed = removePendingUser(failed, pendingId);
  assert(failed.length === 0, "removePendingUser drops the optimistic bubble");

  // B7: 已确认（有 entryId）的 pending id 不应被 removePendingUser 误删。
  const confirmed = applyAgentEvent(
    appendPendingUser(createEmptyState(), "sent", pendingId),
    { type: "user_message", text: "sent", id: "u-real", entryId: "entry-9" },
  );
  const afterFailedRemove = removePendingUser(confirmed, pendingId);
  assert(
    afterFailedRemove.length === 1,
    "removePendingUser keeps confirmed user bubble",
  );
}

// B7: 双 pending（连发两条）按 FIFO 归并，不串位。
{
  let items = createEmptyState();
  const idA = makePendingUserId();
  const idB = makePendingUserId();
  items = appendPendingUser(items, "message A", idA);
  items = appendPendingUser(items, "message B", idB);
  // 事件按发送顺序到达：A 先替换第一个 pending，B 替换第二个。
  items = applyAgentEvent(items, {
    type: "user_message",
    text: "message A",
    id: "u-A",
    entryId: "entry-A",
  });
  items = applyAgentEvent(items, {
    type: "user_message",
    text: "message B",
    id: "u-B",
    entryId: "entry-B",
  });
  assert(
    items.length === 2 &&
      items[0]!.kind === "user" &&
      items[0]!.id === idA &&
      (items[0] as { entryId?: string }).entryId === "entry-A" &&
      items[1]!.kind === "user" &&
      items[1]!.id === idB &&
      (items[1] as { entryId?: string }).entryId === "entry-B",
    "double pending resolves FIFO without swapping content",
  );
}

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

items = applyAgentEvent(items, {
  type: "assistant_start",
  messageId: "a3",
  userEntryId: "entry-from-host",
});
const a3 = items.find((i) => i.kind === "assistant" && i.id === "a3");
assert(
  a3?.kind === "assistant" && a3.userEntryId === "entry-from-host",
  "assistant_start should prefer event.userEntryId over backfill",
);

// Late tool_update after tool_end must not overwrite the final result.
{
  let tools = createEmptyState();
  tools = applyAgentEvent(tools, {
    type: "tool_start",
    toolCallId: "t1",
    toolName: "bash",
    args: { command: "ls" },
  });
  tools = applyAgentEvent(tools, {
    type: "tool_update",
    toolCallId: "t1",
    partialResult: "partial",
  });
  tools = applyAgentEvent(tools, {
    type: "tool_end",
    toolCallId: "t1",
    toolName: "bash",
    result: "final",
    isError: false,
  });
  tools = applyAgentEvent(tools, {
    type: "tool_update",
    toolCallId: "t1",
    partialResult: "stale-late",
  });
  const t = tools.find((i) => i.kind === "tool" && i.id === "t1");
  assert(
    t?.kind === "tool" && t.done && t.result === "final",
    "tool_update after done must be ignored",
  );
}

console.log("test-chat-store: ok");
