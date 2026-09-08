/**
 * Vitest 单元测试 —— provider-pi-models
 *
 * 锁住 `modelEntryForPiModelsJson` 对 `input` 字段的透传行为:
 * 1. input === undefined 不写 (让 Pi SDK applyModelsJson 走 `?? model.input` 兜底)
 * 2. input 数组透传到 Pi models.json entry
 * 3. DeepSeek / MiniMax 路径 input 仍被透传 (不被 reasoning/compat 覆盖)
 */
import { describe, expect, it } from "vitest";
import type { ProviderModelEntry } from "../../shared/ipc";
import { modelEntryForPiModelsJson } from "./provider-pi-models";

function baseEntry(overrides: Partial<ProviderModelEntry> = {}): ProviderModelEntry {
  return {
    id: "test-model",
    ...overrides,
  };
}

describe("modelEntryForPiModelsJson — input 透传", () => {
  it("input === undefined 时 entry 不带 input 字段 (Pi SDK 兜底)", () => {
    const out = modelEntryForPiModelsJson(
      baseEntry(),
      "openai-completions",
      "test-provider",
      "https://example.com/v1",
    );
    expect(out.id).toBe("test-model");
    expect("input" in out).toBe(false);
  });

  it("input = ['text','image'] 透传", () => {
    const out = modelEntryForPiModelsJson(
      baseEntry({ input: ["text", "image"] }),
      "openai-completions",
      "test-provider",
      "https://example.com/v1",
    );
    expect(out.input).toEqual(["text", "image"]);
  });

  it("input = ['text'] 透传", () => {
    const out = modelEntryForPiModelsJson(
      baseEntry({ input: ["text"] }),
      "anthropic-messages",
      "test-provider",
      "https://example.com/anthropic",
    );
    expect(out.input).toEqual(["text"]);
  });

  it("DeepSeek 路径: input 透传且不被 reasoning/compat 覆盖", () => {
    // siliconflow 代理 deepseek: providerId 非 deepseek, baseUrl 非 deepseek.com,
    // api=openai-completions → X-agent 仍写 compat, 同时 input 透传。
    const out = modelEntryForPiModelsJson(
      baseEntry({ id: "deepseek-v4-pro", input: ["text", "image"] }),
      "openai-completions",
      "siliconflow",
      "https://api.siliconflow.cn/v1",
    );
    expect(out.id).toBe("deepseek-v4-pro");
    expect(out.input).toEqual(["text", "image"]);
    expect(out.reasoning).toBe(true);
    expect(out.compat).toBeDefined();
  });

  it("DeepSeek v4 thinkingLevelMap 注入, input 仍透传", () => {
    const out = modelEntryForPiModelsJson(
      baseEntry({ id: "deepseek-v4-flash", input: ["text"] }),
      "openai-completions",
      "deepseek",
      "https://api.deepseek.com",
    );
    expect(out.input).toEqual(["text"]);
    // deepseek.com baseUrl + openai-completions 时, Pi SDK 会自动识别 DeepSeek,
    // X-agent 不写 compat (避免覆盖 builtin), 但 reasoning 仍写。
    expect(out.reasoning).toBe(true);
  });

  it("MiniMax 路径: input 透传且不被 reasoning/compat 覆盖", () => {
    const out = modelEntryForPiModelsJson(
      baseEntry({ id: "MiniMax-M3", input: ["text", "image"] }),
      "anthropic-messages",
      "minimax",
      "https://api.minimaxi.com/anthropic",
    );
    expect(out.id).toBe("MiniMax-M3");
    expect(out.input).toEqual(["text", "image"]);
    expect(out.reasoning).toBe(true);
    expect(out.compat).toEqual({ forceAdaptiveThinking: true });
    expect(out.thinkingLevelMap).toBeDefined();
  });

  it("contextWindow 缺省时也不被注入, input 透传正常", () => {
    const out = modelEntryForPiModelsJson(
      baseEntry({ input: ["text", "image"] }),
      "openai-completions",
      "test-provider",
      "https://example.com/v1",
    );
    // enrichModelEntry 在 lookupKnownContextWindow 也没命中时, 不写 contextWindow。
    expect("contextWindow" in out).toBe(false);
    expect(out.input).toEqual(["text", "image"]);
  });
});
