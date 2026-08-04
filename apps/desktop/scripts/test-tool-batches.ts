/**
 * 测试 deriveToolBatches / summarizeToolBatch / toolBatchOpenForDoneTransition
 * —— 把 ChatItem[] 派生出"按批次合并的渲染列表"。
 *
 * 关键不变量:
 *   - 单个孤立 tool 不包批次 (保持 ToolCard 原视觉)
 *   - ≥2 连续 tool 合并为 toolBatch
 *   - 任意非 tool (user / assistant / system) 打断批次
 *   - 输入数组不被修改 (派生函数)
 *   - history_replace 整体替换数组后派生结果同步变化
 */
import assert from "node:assert/strict";
import {
  applyAgentEvent,
  createEmptyState,
  type ChatItem,
} from "../src/stores/chat-store";
import {
  deriveToolBatches,
  summarizeToolBatch,
  toolBatchOpenForDoneTransition,
} from "../src/lib/chat-tool-batches";

// ----------------------- helpers -----------------------

/** 构造一条已完成的 tool 项 (done=true, isError=false)。 */
function doneTool(id: string, name = "bash"): ChatItem {
  return {
    kind: "tool",
    id,
    toolName: name,
    args: { command: "ls" },
    result: "ok",
    done: true,
  };
}

/** 构造一条运行中的 tool 项 (done=false)。 */
function runningTool(id: string): ChatItem {
  return {
    kind: "tool",
    id,
    toolName: "bash",
    args: { command: "ls" },
    done: false,
  };
}

// ----------------------- deriveToolBatches -----------------------

// [1] 连续 3 tool → 1 个 batch
{
  const items: ChatItem[] = [
    doneTool("t1"),
    doneTool("t2"),
    doneTool("t3"),
  ];
  const out = deriveToolBatches(items);
  assert(out.length === 1, "3 consecutive tools should become 1 batch");
  const batch = out[0]!;
  assert(batch.kind === "toolBatch", "should be a toolBatch node");
  assert(batch.items.length === 3, "batch should contain all 3 tools");
  assert(batch.id === "batch-t1", "batch id should derive from first tool");
}

// [2] 单个孤立 tool → 原 tool 行, 不包批次
{
  const items: ChatItem[] = [doneTool("solo")];
  const out = deriveToolBatches(items);
  assert(out.length === 1, "single tool stays as 1 entry");
  assert(out[0]!.kind === "tool", "single tool should NOT be wrapped as batch");
}

// [3] tool + user + tool → 2 个原 tool (user 打断)
{
  const items: ChatItem[] = [
    doneTool("t1"),
    { kind: "user", id: "u1", text: "hi" },
    doneTool("t2"),
  ];
  const out = deriveToolBatches(items);
  assert(out.length === 3, "user between tools should split into 3 entries");
  assert(out[0]!.kind === "tool");
  assert(out[1]!.kind === "user");
  assert(out[2]!.kind === "tool");
}

// [4] tool + system + tool → 2 个原 tool (system 打断)
{
  const items: ChatItem[] = [
    doneTool("t1"),
    { kind: "system", id: "s1", text: "notice", level: "info" },
    doneTool("t2"),
  ];
  const out = deriveToolBatches(items);
  assert(out.length === 3, "system between tools should split into 3 entries");
  assert(out[0]!.kind === "tool");
  assert(out[1]!.kind === "system");
  assert(out[2]!.kind === "tool");
}

// [5] tool + assistant + tool → 2 个原 tool (assistant 打断)
{
  const items: ChatItem[] = [
    doneTool("t1"),
    {
      kind: "assistant",
      id: "a1",
      text: "thinking...",
      thinking: "",
      done: true,
    },
    doneTool("t2"),
  ];
  const out = deriveToolBatches(items);
  assert(out.length === 3, "assistant between tools should split");
  assert(out[0]!.kind === "tool");
  assert(out[1]!.kind === "assistant");
  assert(out[2]!.kind === "tool");
}

// [6] 复杂交错: 2 个 batch + 2 个 tool (最后两个 tool 形成 1 batch)
{
  const items: ChatItem[] = [
    doneTool("t1"),
    doneTool("t2"),
    { kind: "user", id: "u1", text: "go on" },
    doneTool("t3"),
    doneTool("t4"),
  ];
  const out = deriveToolBatches(items);
  assert(out.length === 3, "2 batches + 1 user = 3 entries");
  assert(out[0]!.kind === "toolBatch" && out[0]!.items.length === 2);
  assert(out[1]!.kind === "user");
  assert(out[2]!.kind === "toolBatch" && out[2]!.items.length === 2);
}

// [7] 边界: 头部/尾部都是 tool
{
  const items: ChatItem[] = [
    doneTool("a"),
    doneTool("b"),
    { kind: "user", id: "u", text: "x" },
    doneTool("c"),
  ];
  const out = deriveToolBatches(items);
  assert(out.length === 3, "head batch + user + tail single");
  assert(out[0]!.kind === "toolBatch" && out[0]!.items.length === 2);
  assert(out[1]!.kind === "user");
  assert(out[2]!.kind === "tool"); // 尾部只剩 1 个,不包批次
}

// [8] 不修改输入
{
  const items: ChatItem[] = [doneTool("a"), doneTool("b")];
  const before = JSON.stringify(items);
  deriveToolBatches(items);
  assert(JSON.stringify(items) === before, "input array must not be mutated");
}

// [9] 空数组
{
  const out = deriveToolBatches([]);
  assert(out.length === 0, "empty input → empty output");
}

// [10] 全是非 tool
{
  const items: ChatItem[] = [
    { kind: "user", id: "u1", text: "hi" },
    {
      kind: "assistant",
      id: "a1",
      text: "hello",
      thinking: "",
      done: true,
    },
    { kind: "system", id: "s1", text: "ok", level: "info" },
  ];
  const out = deriveToolBatches(items);
  assert(out.length === 3, "all non-tool items pass through");
  for (const x of out) assert(x.kind !== "toolBatch");
}

// [11] history_replace 后派生: 整组替换数组,派生函数重新计算
{
  let items: ChatItem[] = createEmptyState();
  items = applyAgentEvent(items, { type: "user_message", text: "go", id: "u1" });
  // 第一段 assistant 流: 跑 3 个 tool
  items = applyAgentEvent(items, {
    type: "tool_start",
    toolCallId: "t1",
    toolName: "bash",
    args: { cmd: "ls" },
  });
  items = applyAgentEvent(items, {
    type: "tool_end",
    toolCallId: "t1",
    toolName: "bash",
    result: "ok",
    isError: false,
  });
  items = applyAgentEvent(items, {
    type: "tool_start",
    toolCallId: "t2",
    toolName: "bash",
    args: { cmd: "pwd" },
  });
  items = applyAgentEvent(items, {
    type: "tool_end",
    toolCallId: "t2",
    toolName: "bash",
    result: "ok",
    isError: false,
  });
  // 模拟 history_replace 用新数组替换 (压缩后只保留 user + 一个 tool)
  items = [
    items[0]!, // user
    doneTool("t-merged", "read"), // 只剩 1 个 tool
  ];
  const out = deriveToolBatches(items);
  assert(out.length === 2, "after history_replace: 1 user + 1 tool");
  assert(out[0]!.kind === "user");
  assert(out[1]!.kind === "tool"); // 孤立, 不包批次
}

// [12] 三个 tool 中混入 1 个 running tool,边界仍按相同规则合并
{
  const items: ChatItem[] = [
    doneTool("t1"),
    runningTool("t2"),
    doneTool("t3"),
  ];
  const out = deriveToolBatches(items);
  assert(out.length === 1, "3 consecutive regardless of running state");
  assert(out[0]!.kind === "toolBatch" && out[0]!.items.length === 3);
}

// ----------------------- summarizeToolBatch -----------------------

{
  const items = [
    doneTool("t1"), // done
    { ...doneTool("t2"), isError: true } as ChatItem, // failed
    runningTool("t3"), // running
    doneTool("t4"), // done
  ];
  const sum = summarizeToolBatch(
    items as Extract<ChatItem, { kind: "tool" }>[],
  );
  assert(sum.done === 2, "done count");
  assert(sum.failed === 1, "failed count");
  assert(sum.running === 1, "running count");
  assert(sum.allDone === false, "allDone false when running present");
}

{
  const items = [doneTool("t1"), doneTool("t2")];
  const sum = summarizeToolBatch(items);
  assert(sum.done === 2 && sum.failed === 0 && sum.running === 0);
  assert(sum.allDone === true, "allDone true when no running");
}

{
  const items = [{ ...doneTool("t1"), isError: true } as ChatItem];
  const sum = summarizeToolBatch(
    items as Extract<ChatItem, { kind: "tool" }>[],
  );
  assert(sum.failed === 1 && sum.allDone === true, "failed still counts as done");
}

// ----------------------- toolBatchOpenForDoneTransition -----------------------

assert.equal(toolBatchOpenForDoneTransition(false, false), true, "running → open");
assert.equal(toolBatchOpenForDoneTransition(true, false), true, "still running → open");
assert.equal(toolBatchOpenForDoneTransition(false, true), false, "just finished → close once");
assert.equal(toolBatchOpenForDoneTransition(true, true), null, "already done → leave user alone");

console.log("test-tool-batches: ok");
