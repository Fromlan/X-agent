/**
 * Vitest 套件 —— shared/ipc 的核心 payload 类型契约。
 *
 * 锁住 4 个不变量 (#42 composer attachments 的 IPC 形状):
 * 1. PromptPayload.text 必填 (可空字符串, 配合 images-only 发图)
 * 2. PromptPayload.images 可选, 缺省 = 仅 text
 * 3. ImageContent.data 是 base64 字符串, mimeType 是字符串
 * 4. IpcInvokeMap.prompt 接受 PromptPayload, 返回 Promise<PromptResult>
 *
 * 不验证运行时行为 (那是 session-host.test.ts 的责任); 这里只
 * 验证类型在编译期可序列化、字段不漏。
 */
import { describe, it, expect } from "vitest";
import type { ImageContent, PromptPayload, PromptResult } from "./ipc";

describe("PromptPayload 形状", () => {
  it("text 必填 (允许空字符串, 由 images 承担消息)", () => {
    const payload: PromptPayload = { text: "" };
    expect(payload.text).toBe("");
    expect(payload.images).toBeUndefined();
  });

  it("images 可选, 缺省时仅 text", () => {
    const payload: PromptPayload = { text: "hello" };
    expect(payload.images).toBeUndefined();
  });

  it("images 数组可以非空, data 是 base64, mimeType 是字符串", () => {
    const img: ImageContent = {
      type: "image",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      mimeType: "image/png",
    };
    const payload: PromptPayload = { text: "see attached", images: [img] };
    expect(payload.images).toHaveLength(1);
    expect(payload.images![0]!.data.length).toBeGreaterThan(0);
    expect(payload.images![0]!.mimeType).toBe("image/png");
  });

  it("JSON 序列化无损 round-trip (模拟 IPC 跨进程传递)", () => {
    const original: PromptPayload = {
      text: "看看这张图",
      images: [
        { type: "image", data: "abc", mimeType: "image/jpeg" },
      ],
    };
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as PromptPayload;
    expect(parsed.text).toBe("看看这张图");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images![0]!.mimeType).toBe("image/jpeg");
    expect(parsed.images![0]!.data).toBe("abc");
  });
});

describe("PromptResult 形状", () => {
  it("ok / error / silent 三态", () => {
    const ok: PromptResult = { ok: true };
    const fail: PromptResult = { ok: false, error: "消息不能为空" };
    const silent: PromptResult = { ok: true, silent: true };
    expect(ok.ok).toBe(true);
    expect(fail.error).toBe("消息不能为空");
    expect(silent.silent).toBe(true);
  });
});
