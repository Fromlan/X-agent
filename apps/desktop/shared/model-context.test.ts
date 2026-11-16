/**
 * Vitest 套件 —— DeepSeek 模型上下文窗口查表 (issue 同步 DeepSeek 当前 lineup)。
 *
 * 锁住以下不变量:
 * 1. deepseek-flash -> 1_000_000 (与 V4 家族一致)
 * 2. deepseek-v4-flash / deepseek-v4-pro 回归 -> 1_000_000
 * 3. retired DeepSeek aliases remain unknown unless the endpoint reports a limit
 * 4. enrichModelEntry 同样把 deepseek-flash 注入 1M contextWindow
 */
import { describe, expect, it } from "vitest";
import {
  enrichModelEntry,
  lookupKnownContextWindow,
  parseContextWindowFromApiModel,
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

  it("does not guess a retired deepseek-chat alias", () => {
    expect(lookupKnownContextWindow("deepseek-chat")).toBeUndefined();
  });

  it("does not guess a retired deepseek-reasoner alias", () => {
    expect(lookupKnownContextWindow("deepseek-reasoner")).toBeUndefined();
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

describe("capacity provenance and independent limits", () => {
  it.each([
    "claude-opus-4-9", "claude-sonnet-4-7", "claude-sonnet-5-9", "claude-opus-5-6",
    "claude-fable-5-9", "claude-mythos-5-9", "claude-haiku-5", "claude-3-7-haiku",
    "claude-fictional-99-1m", "claude-fictional-99[1m]", "claude-opus-6[1m]",
    "claude-opus-4-8-experimental", "claude-mythos-preview-next",
  ])("does not infer capacity for an unpublished Claude model: %s", (id) => {
    expect(lookupKnownContextWindow(id)).toBeUndefined();
  });

  it.each([
    "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-6",
    "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-sonnet-5-5", "claude-haiku-5-5",
    "claude-fable-5", "claude-fable-5-1", "claude-fable-5-2",
    "claude-mythos-5", "claude-mythos-5-1", "claude-mythos-5-2", "claude-mythos-preview",
  ])("preserves the published 1M Claude window: %s", (id) => {
    expect(lookupKnownContextWindow(id)).toBe(1_000_000);
  });

  it.each([
    ["claude-opus-4-7[1m]", 1_000_000], ["anthropic/claude-opus-4-8-latest", 1_000_000],
    ["claude-sonnet-4-5-20250929", 200_000], ["claude-3-5-sonnet-latest", 200_000],
    ["claude-sonnet-4-6-latest-1m", 1_000_000],
  ])("recognizes explicit metadata suffixes without changing the base model capacity: %s", (id, expected) => {
    expect(lookupKnownContextWindow(String(id))).toBe(expected);
  });

  it.each(["claude-sonnet-4[1m]", "claude-sonnet-4-5-20250929-1m"])(
    "does not restore the retired Sonnet 1M beta through a model label: %s",
    (id) => {
      expect(lookupKnownContextWindow(id)).toBe(200_000);
    },
  );

  it("uses documented API windows instead of effective coding-agent budgets", () => {
    expect(lookupKnownContextWindow("gpt-4.1-2025-04-14")).toBe(1_047_576);
    expect(lookupKnownContextWindow("gpt-5.4")).toBe(1_050_000);
    expect(lookupKnownContextWindow("claude-sonnet-4-6")).toBe(1_000_000);
    expect(lookupKnownContextWindow("claude-fictional-99")).toBeUndefined();
  });

  it("does not conflate a reported input limit with the full context window", () => {
    expect(parseContextWindowFromApiModel({ max_input_tokens: 90_000 })).toBeUndefined();
  });

  it("refreshes tagged catalog guesses while preserving explicit and legacy user values", () => {
    expect(enrichModelEntry({ id: "gpt-4.1", contextWindow: 128_000, contextWindowSource: "catalog" as const }).contextWindow).toBe(1_047_576);
    expect(enrichModelEntry({ id: "gpt-4.1", contextWindow: 42_000 }).contextWindow).toBe(42_000);
    expect(enrichModelEntry({ id: "gpt-4.1", contextWindow: 42_000, contextWindowSource: "explicit" as const }).contextWindow).toBe(42_000);
  });
});
