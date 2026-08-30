/**
 * Vitest 套件 —— shared/transcript/apply-events 的 user bubble / images 行为。
 *
 * 锁住 4 个不变量 (#42 修复 #2:user bubble 缺图):
 * 1. appendPendingUser 带 images → bubble 含 images (供 UserBubble 渲染)
 * 2. appendPendingUser 不带 images → bubble 不写空数组 (避免 HistoryItem 噪声)
 * 3. appendPendingUser 带空数组 → 同 #2,字段不写入
 * 4. user_message 事件合并 pending bubble 时保留 prev.images,只覆盖 text/entryId
 *    (主进程不感知 images 来源,renderer 侧把已附图透传到底)
 */
import { describe, it, expect } from "vitest";
import type { ImageContent, UiAgentEvent } from "../ipc";
import {
  PENDING_USER_ID_PREFIX,
  appendPendingUser,
  applyAgentEvent,
  makePendingUserId,
} from "./apply-events";

const PNG_DATA =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function png(mimeType: string = "image/png"): ImageContent {
  return { type: "image", data: PNG_DATA, mimeType };
}

describe("appendPendingUser + images", () => {
  it("带 images → bubble 含 images", () => {
    const out = appendPendingUser([], "看看这张图", undefined, [png()]);
    expect(out).toHaveLength(1);
    const bubble = out[0]!;
    expect(bubble.kind).toBe("user");
    if (bubble.kind !== "user") return; // type narrow
    expect(bubble.images).toBeDefined();
    expect(bubble.images).toHaveLength(1);
    expect(bubble.images![0]!.mimeType).toBe("image/png");
    expect(bubble.images![0]!.data).toBe(PNG_DATA);
  });

  it("不带 images → bubble 不写空字段 (避免 HistoryItem 噪声)", () => {
    const out = appendPendingUser([], "纯文字消息");
    expect(out).toHaveLength(1);
    const bubble = out[0]!;
    expect(bubble.kind).toBe("user");
    if (bubble.kind !== "user") return;
    expect(bubble.images).toBeUndefined();
  });

  it("传空数组 → bubble 不写字段 (语义同不带)", () => {
    const out = appendPendingUser([], "空数组", undefined, []);
    expect(out).toHaveLength(1);
    const bubble = out[0]!;
    expect(bubble.kind).toBe("user");
    if (bubble.kind !== "user") return;
    expect(bubble.images).toBeUndefined();
  });

  it("custom id + images → 用传入 id,images 落底", () => {
    const id = makePendingUserId();
    expect(id.startsWith(PENDING_USER_ID_PREFIX)).toBe(true);
    const out = appendPendingUser([], "带 id", id, [png("image/jpeg")]);
    const bubble = out[0]!;
    expect(bubble.kind).toBe("user");
    if (bubble.kind !== "user") return;
    expect(bubble.id).toBe(id);
    expect(bubble.images).toHaveLength(1);
    expect(bubble.images![0]!.mimeType).toBe("image/jpeg");
  });
});

describe("user_message 事件合并保留 images", () => {
  it("merge 时保留 prev.images,只覆盖 text / entryId", () => {
    // 模拟 send → appendPendingUser 把 images 落进 pending bubble
    const items = appendPendingUser([], "看图", undefined, [png(), png("image/jpeg")]);
    expect(items).toHaveLength(1);

    // 主进程回 user_message 事件 —— 载荷只有 text / entryId,没有 images
    const event: UiAgentEvent = {
      type: "user_message",
      text: "[expanded] 看图 <file>...</file>",
      entryId: "u-1",
    };
    const merged = applyAgentEvent(items, event);

    expect(merged).toHaveLength(1);
    const bubble = merged[0]!;
    expect(bubble.kind).toBe("user");
    if (bubble.kind !== "user") return;

    // text 走主进程回来的 expanded 版
    expect(bubble.text).toBe("[expanded] 看图 <file>...</file>");
    expect(bubble.entryId).toBe("u-1");
    // images 必须保留
    expect(bubble.images).toBeDefined();
    expect(bubble.images).toHaveLength(2);
    expect(bubble.images![0]!.mimeType).toBe("image/png");
    expect(bubble.images![1]!.mimeType).toBe("image/jpeg");
  });

  it("若 prev 没有 images,合并后仍无 images (不臆造)", () => {
    const items = appendPendingUser([], "纯文字");
    const event: UiAgentEvent = {
      type: "user_message",
      text: "[expanded] 纯文字",
      entryId: "u-2",
    };
    const merged = applyAgentEvent(items, event);
    const bubble = merged[0]!;
    expect(bubble.kind).toBe("user");
    if (bubble.kind !== "user") return;
    expect(bubble.images).toBeUndefined();
  });
});
