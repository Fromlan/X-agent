import assert from "node:assert/strict";
import {
  DEFAULT_TITLE,
  deriveSessionTitle,
  displaySessionName,
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

console.log("test-session-title: ok");
