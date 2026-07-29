import assert from "node:assert/strict";
import {
  DEFAULT_TITLE,
  TITLE_SUMMARY_INSTRUCTION,
  buildTitleSummaryPrompt,
  deriveSessionTitle,
  displaySessionName,
  ensureSessionTitle,
  sanitizeModelTitle,
  truncateTitle,
} from "../electron/agent/session-title.ts";

assert.equal(displaySessionName(undefined), DEFAULT_TITLE);
assert.equal(displaySessionName("  "), DEFAULT_TITLE);
assert.equal(displaySessionName("我的会话"), "我的会话");
assert.equal(
  displaySessionName(undefined, "帮我修复导航网格生成报错"),
  "帮我修复导航网格生成报错",
);

assert.equal(
  deriveSessionTitle("帮我实现一个简单的背包系统"),
  "帮我实现一个简单的背包系统",
);

const long = "请帮我仔细检查这个很长很长很长很长很长很长很长很长很长很长的需求描述并给出方案";
const titled = deriveSessionTitle(long);
assert.ok(titled.length <= 37, titled);
assert.ok(titled.endsWith("…") || titled.length <= 36, titled);

assert.equal(
  deriveSessionTitle("看看", "导航网格在动态障碍物下未更新"),
  "看看 — 导航网格在动态障碍物下未更新",
);

assert.equal(truncateTitle("第一行\n第二行内容"), "第一行");
assert.equal(DEFAULT_TITLE, "新对话");

assert.ok(TITLE_SUMMARY_INSTRUCTION.includes(DEFAULT_TITLE));
const prompt = buildTitleSummaryPrompt("你好", "你好！我是助手");
assert.ok(prompt.startsWith(TITLE_SUMMARY_INSTRUCTION));
assert.ok(prompt.includes("用户：你好"));
assert.ok(prompt.includes("助手："));
assert.ok(!prompt.toLowerCase().includes("system"));
assert.ok(!prompt.includes("tool"));

assert.equal(sanitizeModelTitle("标题：背包系统"), "背包系统");
assert.equal(sanitizeModelTitle('"导航网格修复"'), "导航网格修复");
assert.equal(sanitizeModelTitle("你好。"), "你好");
assert.equal(sanitizeModelTitle("  "), "");
assert.equal(
  sanitizeModelTitle("第一行标题\n不要第二行"),
  "第一行标题",
);

{
  const skipped = await ensureSessionTitle({
    currentName: "已有标题",
    userText: "你好",
    assistantText: "嗨",
  });
  assert.deepEqual(skipped, { action: "skip" });
}

{
  const empty = await ensureSessionTitle({
    userText: "",
    assistantText: "",
  });
  assert.equal(empty, null);
}

{
  const local = await ensureSessionTitle({
    userText: "帮我实现背包系统",
    assistantText: "好的",
  });
  assert.ok(local && local.action === "set");
  assert.equal(local.source, "fallback");
  assert.ok(local.title.length > 0);
}

{
  const fromModel = await ensureSessionTitle({
    userText: "帮我实现背包系统",
    assistantText: "好的",
    complete: async () => "标题：导航修复",
  });
  assert.ok(fromModel && fromModel.action === "set");
  assert.equal(fromModel.source, "model");
  assert.equal(fromModel.title, "导航修复");
}

{
  let stale = false;
  const aborted = await ensureSessionTitle({
    userText: "你好",
    assistantText: "嗨",
    complete: async () => {
      stale = true;
      return "不应使用";
    },
    isStale: () => stale,
  });
  assert.equal(aborted, null);
}

console.log("test-session-title: ok");
