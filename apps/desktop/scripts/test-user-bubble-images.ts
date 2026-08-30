/**
 * Headless 端到端断言 —— user bubble images 数据流 (#42 修复 #2)。
 *
 * 走完一条 send 链路:
 *   1. renderer 端:appendPendingUser 带 images → pending bubble 含 images
 *   2. IPC:PromptPayload 序列化无损 round-trip (images 数组 + base64 字段)
 *   3. 主进程回 user_message 事件 → apply-events 合并保留 prev.images
 *   4. 最终 bubble = { kind: "user", text, entryId, images: [...] }  ← UserBubble 喂这个
 *
 * 锁住 4 个不变量:
 *   a. appendPendingUser 带 images 后 bubble.images 是非空数组
 *   b. bubble.images 数组里的元素形状 = { type: "image", data, mimeType }
 *   c. PromptPayload 跨 IPC 序列化后,images 数组无损 (用 JSON.stringify 模拟)
 *   d. user_message 事件合并后,bubble.images 完整保留
 *
 * 不渲染 React —— node 环境无 jsdom,且 UserBubble 渲染逻辑简单(只读
 * item.images),数据层锁定后由 vitest 覆盖 1-2 个关键 props (见
 * shared/transcript/apply-events.test.ts)。
 */
import assert from "node:assert/strict";
import type { HistoryItem, ImageContent, PromptPayload } from "../shared/ipc";
import {
  PENDING_USER_ID_PREFIX,
  appendPendingUser,
  applyAgentEvent,
  makePendingUserId,
  type ChatItem,
} from "../shared/transcript";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z";

function png(): ImageContent {
  return { type: "image", data: PNG_BASE64, mimeType: "image/png" };
}
function jpeg(): ImageContent {
  return { type: "image", data: JPEG_BASE64, mimeType: "image/jpeg" };
}

// === a. appendPendingUser 带 images 后 bubble.images 是非空数组 ===
{
  const items = appendPendingUser([], "看截图", undefined, [png(), jpeg()]);
  assert.equal(items.length, 1, "1 bubble");
  const bubble = items[0]!;
  assert.equal(bubble.kind, "user");
  assert.ok(bubble.images, "bubble.images 存在");
  assert.equal(bubble.images!.length, 2, "2 张图");
}

// === b. bubble.images 元素形状 = { type: "image", data, mimeType } ===
{
  const items = appendPendingUser([], "x", undefined, [png()]);
  const bubble = items[0]!;
  assert.equal(bubble.images![0]!.type, "image");
  assert.equal(bubble.images![0]!.mimeType, "image/png");
  assert.equal(bubble.images![0]!.data, PNG_BASE64);
}

// === c. PromptPayload 跨 IPC 序列化后,images 数组无损 ===
{
  const payload: PromptPayload = {
    text: "看图",
    images: [png(), jpeg()],
  };
  const json = JSON.stringify(payload);
  const restored = JSON.parse(json) as PromptPayload;
  assert.equal(restored.text, "看图");
  assert.equal(restored.images!.length, 2);
  assert.equal(restored.images![0]!.mimeType, "image/png");
  assert.equal(restored.images![0]!.data, PNG_BASE64);
  assert.equal(restored.images![1]!.mimeType, "image/jpeg");
  assert.equal(restored.images![1]!.data, JPEG_BASE64);
}

// === d. user_message 事件合并后 bubble.images 完整保留 ===
{
  // 1) renderer 端 send
  const pendingId = makePendingUserId();
  assert.ok(pendingId.startsWith(PENDING_USER_ID_PREFIX), "pending id 前缀");

  let items: ChatItem[] = appendPendingUser(
    [],
    "看图",
    pendingId,
    [png(), jpeg()],
  );
  assert.ok(items[0]!.images, "pending 带 images");

  // 2) IPC 走 PromptPayload (省略,详见 c 段)

  // 3) 主进程回 user_message 事件 —— 载荷只有 text / entryId,无 images
  //    Pi 生成的新 id 与 pending 不同,触发合并分支(若 id 相同则早返,
  //    等于「该 pending 已被合并过」,本次不重复处理 —— 见 apply-events.ts)
  const items2 = applyAgentEvent(items, {
    type: "user_message",
    text: "[expanded] 看图",
    id: "pi-generated-id-1",
    entryId: "entry-1",
  });

  // 4) 最终 bubble
  const final = items2[0]!;
  assert.equal(final.kind, "user");
  assert.equal(final.text, "[expanded] 看图");
  assert.equal(final.entryId, "entry-1");
  assert.ok(final.images, "合并后 images 仍存在");
  assert.equal(final.images!.length, 2, "2 张图全保留");
  assert.equal(final.images![0]!.data, PNG_BASE64, "第 1 张 base64 不变");
  assert.equal(final.images![1]!.data, JPEG_BASE64, "第 2 张 base64 不变");
}

// === 边界:不带 images 的纯文字消息,合并后也不臆造 images ===
{
  let items: ChatItem[] = appendPendingUser([], "纯文字");
  items = applyAgentEvent(items, {
    type: "user_message",
    text: "[expanded] 纯文字",
    id: "pi-generated-id-2",
    entryId: "entry-2",
  });
  const final = items[0]!;
  assert.equal(final.kind, "user");
  assert.equal(final.images, undefined, "纯文字消息不写 images 字段");
}

// === 边界:HistoryItem.user.images 类型契约 (编译期即可) ===
{
  // 这段不运行时检查,仅作为类型契约的引用。手动 review:
  // type HistoryItem = | { kind: "user"; id: string; text: string;
  //                        entryId?: string; images?: ImageContent[] } | ...
  // 字段可选,不破坏现有历史 JSON 反序列化 (branch mapper / history_replace)。
  const sample: HistoryItem = {
    kind: "user",
    id: "u-1",
    text: "hi",
  };
  assert.equal(sample.images, undefined, "字段可选");
}

console.log("test-user-bubble-images: ok");
