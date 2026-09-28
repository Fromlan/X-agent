/**
 * Vitest 套件 —— DeepSeek 模型上下文窗口查表 (issue 同步 DeepSeek 当前 lineup)。
 *
 * 锁住以下不变量:
 * 1. deepseek-flash -> 1_000_000 (与 V4 家族一致)
 * 2. deepseek-v4-flash / deepseek-v4-pro 回归 -> 1_000_000
 * 3. deepseek-chat / deepseek-reasoner 回归 -> 128_000
 * 4. enrichModelEntry 同样把 deepseek-flash 注入 1M contextWindow
 */
import { describe, expect, it } from "vitest";
import {
  enrichModelEntry,
  lookupKnownContextWindow,
} from "./model-context";

describe("model-context — DeepSeek lineup", () => {
  it("deepseek-flash → 1M", () => {
    expect(lookupKnownContextWindow("deepseek-flash")).toBe(1_000_000);
  });

  it("deepseek-flash 经 vendor 前缀 (deepseek-flash) 仍命中", () => {
    expect(lookupKnownContextWindow("deepseek-ai/DeepSeek-Flash")).toBe(
      1_000_000,
    );
  });

  it("deepseek-v4-flash → 1M (回归)", () => {
    expect(lookupKnownContextWindow("deepseek-v4-flash")).toBe(1_000_000);
  });

  it("deepseek-v4-pro → 1M (回归)", () => {
    expect(lookupKnownContextWindow("deepseek-v4-pro")).toBe(1_000_000);
  });

  it("deepseek-chat → 128k (回归)", () => {
    expect(lookupKnownContextWindow("deepseek-chat")).toBe(128_000);
  });

  it("deepseek-reasoner → 128k (回归)", () => {
    expect(lookupKnownContextWindow("deepseek-reasoner")).toBe(128_000);
  });

  it("enrichModelEntry: deepseek-flash 自动注入 1M contextWindow", () => {
    const out = enrichModelEntry({ id: "deepseek-flash" });
    expect(out.contextWindow).toBe(1_000_000);
  });

  it("enrichModelEntry: 显式 contextWindow 优先于 lookup", () => {
    const out = enrichModelEntry({
      id: "deepseek-flash",
      contextWindow: 42_000,
    });
    expect(out.contextWindow).toBe(42_000);
  });
});