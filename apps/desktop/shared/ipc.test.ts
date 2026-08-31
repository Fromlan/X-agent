/**
 * Vitest 套件 —— shared/ipc 的核心 payload 类型契约。
 *
 * 锁住以下不变量:
 * 1. PromptPayload 形状 (#42 composer attachments)
 * 2. PromptResult 三态 (ok / error / silent)
 * 3. 工具注册表 derive + boundary (issue #60 主题 D C-306, 2026-08-31):
 *    - AVAILABLE_TOOLS / GODOT_TOOLS 是 source-of-truth (2 个 const 数组)
 *    - ALL_TOGGLEABLE_TOOLS = [...AVAILABLE_TOOLS, ...GODOT_TOOLS] derive
 *    - SESSION_TOOL_REGISTRY = [...ALL_TOGGLEABLE_TOOLS, WRITE_PLAN_TOOL] derive
 *    - typecheck 立即捕获"加了工具忘更新某 list" (加在 AVAILABLE_TOOLS 但
 *      没在 SESSION_TOOL_REGISTRY 用 → 编译报错)
 *    - 本测试锁住无重名 / union 长度 = sum / WRITE_PLAN_TOOL 不冲突
 *
 * 不验证运行时行为 (那是 session-host.test.ts 的责任); 这里只
 * 验证类型在编译期可序列化、字段不漏。
 */
import { describe, it, expect } from "vitest";
import {
  ALL_TOGGLEABLE_TOOLS,
  AVAILABLE_TOOLS,
  GODOT_TOOLS,
  SESSION_TOOL_REGISTRY,
  type BuiltinToolName,
  type GodotToolName,
} from "./ipc";
import { WRITE_PLAN_TOOL } from "./mode-tools";
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

describe("工具注册表 derive + boundary (主题 D C-306)", () => {
  it("AVAILABLE_TOOLS / GODOT_TOOLS 各自非空, 是 source-of-truth", () => {
    expect(AVAILABLE_TOOLS.length).toBeGreaterThan(0);
    expect(GODOT_TOOLS.length).toBeGreaterThan(0);
    // 命名约定: 内置工具无 godot_ 前缀
    for (const t of AVAILABLE_TOOLS) {
      expect(t.startsWith("godot_"), `内置工具不应有 godot_ 前缀: ${t}`).toBe(false);
    }
    // Godot 工具必须有 godot_ 前缀
    for (const t of GODOT_TOOLS) {
      expect(t.startsWith("godot_"), `Godot 工具必须有 godot_ 前缀: ${t}`).toBe(true);
    }
  });

  it("ALL_TOGGLEABLE_TOOLS = AVAILABLE ∪ Godot, 无重名", () => {
    const set = new Set<string>();
    for (const t of ALL_TOGGLEABLE_TOOLS) {
      expect(set.has(t), `ALL_TOGGLEABLE_TOOLS 有重名: ${t}`).toBe(false);
      set.add(t);
    }
    expect(ALL_TOGGLEABLE_TOOLS.length).toBe(AVAILABLE_TOOLS.length + GODOT_TOOLS.length);
  });

  it("SESSION_TOOL_REGISTRY = ALL_TOGGLEABLE + write_plan, 无重名", () => {
    const set = new Set<string>();
    for (const t of SESSION_TOOL_REGISTRY) {
      expect(set.has(t), `SESSION_TOOL_REGISTRY 有重名: ${t}`).toBe(false);
      set.add(t);
    }
    expect(SESSION_TOOL_REGISTRY.length).toBe(
      ALL_TOGGLEABLE_TOOLS.length + 1,
    );
    expect(SESSION_TOOL_REGISTRY).toContain(WRITE_PLAN_TOOL);
  });

  it("BuiltinToolName / GodotToolName 类型与数组同步 (compile-time)", () => {
    // 这一行编译过即通过 — typecheck 已经覆盖.
    const builtin: BuiltinToolName = AVAILABLE_TOOLS[0];
    const godot: GodotToolName = GODOT_TOOLS[0];
    expect(typeof builtin).toBe("string");
    expect(typeof godot).toBe("string");
  });
});
