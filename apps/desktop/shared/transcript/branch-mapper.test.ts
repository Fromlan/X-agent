/**
 * Vitest 套件 —— shared/transcript/branch-mapper 提取 user message 时的图片保留。
 *
 * 锁住 4 个不变量 (#42 修复 #2 续:branch-mapper 之前只取 text,image
 * content block 被丢,所以 history_replace 替换 items 后 user bubble
 * 里的图片就消失):
 * 1. user message 含 text + image → user bubble 同时带 text 和 images
 * 2. user message 只有 text → user bubble 不写 images 字段 (空数组不持久化)
 * 3. user message 只有 image (纯粘贴截图) → text 为空,user bubble 不
 *    创建 (textFromContent 滤掉;与"只粘贴图也走 file ref"语义一致)
 * 4. assistant message 里的 image (tool result 等) 不被算到 user.images
 */
import { describe, it, expect } from "vitest";
import { branchEntriesToHistory } from "./branch-mapper";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function userEntry(
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
  id = "u-1",
  timestamp = 1000,
) {
  return {
    type: "message",
    id,
    message: {
      role: "user",
      content,
      timestamp,
    },
  };
}

describe("branchEntriesToHistory — user message images", () => {
  it("user 消息含 text + image → bubble 带 text 和 images", () => {
    const out = branchEntriesToHistory([
      userEntry([
        { type: "text", text: "看图" },
        { type: "image", data: PNG_BASE64, mimeType: "image/png" },
      ]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("user");
    if (out[0]!.kind !== "user") return;
    expect(out[0]!.text).toBe("看图");
    expect(out[0]!.images).toBeDefined();
    expect(out[0]!.images).toHaveLength(1);
    expect(out[0]!.images![0]!.mimeType).toBe("image/png");
    expect(out[0]!.images![0]!.data).toBe(PNG_BASE64);
  });

  it("user 消息只有 text → bubble 不写 images 字段 (避免空数组噪声)", () => {
    const out = branchEntriesToHistory([userEntry([{ type: "text", text: "hi" }])]);
    expect(out).toHaveLength(1);
    if (out[0]!.kind !== "user") return;
    expect(out[0]!.images).toBeUndefined();
  });

  it("user 消息只有 image (无 text) → 不建 bubble (textFromContent 滤空)", () => {
    // 与 composer "只粘贴截图 + 不输文字" 路径语义一致:必须有 text 才入历史
    // (renderer 端 send 闸门也拒绝纯图片)
    const out = branchEntriesToHistory([
      userEntry([{ type: "image", data: PNG_BASE64, mimeType: "image/png" }]),
    ]);
    expect(out).toHaveLength(0);
  });

  it("user 消息含多张图 → bubble.images 数组全保留", () => {
    const out = branchEntriesToHistory([
      userEntry([
        { type: "text", text: "两张" },
        { type: "image", data: PNG_BASE64, mimeType: "image/png" },
        { type: "image", data: "AAAA", mimeType: "image/jpeg" },
      ]),
    ]);
    expect(out).toHaveLength(1);
    if (out[0]!.kind !== "user") return;
    expect(out[0]!.images).toHaveLength(2);
    expect(out[0]!.images![0]!.mimeType).toBe("image/png");
    expect(out[0]!.images![1]!.mimeType).toBe("image/jpeg");
  });

  it("history_replace 替换 items 时 images 不丢 (#42 修复 #2 真根因)", () => {
    // 模拟 send → history_replace 流程:
    // 1) appendPendingUser 写入带 images 的 pending bubble
    // 2) history_replace 用 branchEntriesToHistory(branch) 替换 items
    // 3) 替换后 user bubble 仍要带 images (这条测的就是这一步)
    const branch = [
      userEntry([
        { type: "text", text: "看图" },
        { type: "image", data: PNG_BASE64, mimeType: "image/png" },
      ]),
    ];
    const replaced = branchEntriesToHistory(branch);
    expect(replaced).toHaveLength(1);
    const bubble = replaced[0]!;
    expect(bubble.kind).toBe("user");
    if (bubble.kind !== "user") return;
    // text 走 textFromContent(trim:false) 后能拿到原文本
    expect(bubble.text).toBe("看图");
    // images 必须保留 (这条之前是 [] — 真根因)
    expect(bubble.images).toBeDefined();
    expect(bubble.images).toHaveLength(1);
    expect(bubble.images![0]!.data).toBe(PNG_BASE64);
    expect(bubble.images![0]!.mimeType).toBe("image/png");
  });
});
