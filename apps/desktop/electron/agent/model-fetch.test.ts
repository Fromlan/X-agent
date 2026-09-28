/**
 * Vitest 套件 —— model-fetch 解析 DeepSeek 扩展 `/v1/models` schema。
 *
 * 锁住以下不变量:
 * 1. `context_window` / `max_output_tokens` / `input_modalities` / `effort` 全读到
 * 2. effort.supported_levels 翻译为 Pi thinkingLevelMap (off-only 形态)
 * 3. 旧 OpenAI 标准响应 (只 id + owned_by) 仍能解析,新字段缺失时返回 undefined
 * 4. 空 id / 非字符串 id 跳过
 */
import { describe, expect, it } from "vitest";
import {
  effortToThinkingLevelMap,
  parseModelsJson,
} from "./model-fetch";

describe("parseModelsJson — DeepSeek 扩展 schema", () => {
  it("读 context_window / max_output_tokens / input_modalities / effort 全套", () => {
    const parsed = parseModelsJson({
      object: "list",
      data: [
        {
          id: "deepseek-flash",
          object: "model",
          owned_by: "deepseek-ai",
          context_window: 1000000,
          max_output_tokens: 8192,
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
          effort: {
            supported_levels: ["high"],
            default_level: "high",
          },
          api_capabilities: {
            anthropic_messages: { system_prompt_update: "leading-only" },
          },
        },
      ],
    });
    expect(parsed).toHaveLength(1);
    const m = parsed[0]!;
    expect(m.id).toBe("deepseek-flash");
    expect(m.ownedBy).toBe("deepseek-ai");
    expect(m.contextWindow).toBe(1000000);
    expect(m.maxOutputTokens).toBe(8192);
    expect(m.input).toEqual(["text", "image"]);
    expect(m.output).toEqual(["text"]);
    expect(m.effort).toEqual({
      supportedLevels: ["high"],
      defaultLevel: "high",
    });
    expect(m.apiCapabilities).toEqual({
      anthropic_messages: { system_prompt_update: "leading-only" },
    });
    // effort supported_levels = ["high"] → off-only 形态 (DeepSeek 官方 on/off 二态)
    expect(m.thinkingLevelMap).toEqual({
      off: "off",
      minimal: "high",
      low: "high",
      medium: "high",
      high: "high",
      max: "high",
    });
  });

  it("支持多档 effort 时按 user-level -> api-level 1:1 近似翻译", () => {
    const parsed = parseModelsJson({
      data: [
        {
          id: "some-model",
          effort: { supported_levels: ["low", "medium", "high"] },
        },
      ],
    });
    expect(parsed[0]?.thinkingLevelMap).toEqual({
      off: "off",
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      max: "high",
    });
  });

  it("effort.supported_levels 为空数组 -> off/null 形态", () => {
    expect(effortToThinkingLevelMap([])).toEqual({
      off: "off",
      minimal: null,
      low: null,
      medium: null,
      high: null,
      max: null,
    });
  });

  it("OpenAI 标准响应 (只 id + owned_by) 仍可解析,新字段全 undefined", () => {
    const parsed = parseModelsJson({
      data: [{ id: "gpt-4o", owned_by: "openai" }],
    });
    expect(parsed).toHaveLength(1);
    const m = parsed[0]!;
    expect(m.id).toBe("gpt-4o");
    expect(m.ownedBy).toBe("openai");
    // contextWindow 走 lookup 兜底 (gpt-4o -> 128k)
    expect(m.contextWindow).toBe(128000);
    expect(m.maxOutputTokens).toBeUndefined();
    expect(m.input).toBeUndefined();
    expect(m.effort).toBeUndefined();
    expect(m.thinkingLevelMap).toBeUndefined();
  });

  it("旧字段 context_length / max_model_len 仍兼容 (vLLM / Ollama 等)", () => {
    const parsed = parseModelsJson({
      data: [
        { id: "llama", context_length: 64000 },
        { id: "qwen", max_model_len: 32768 },
      ],
    });
    expect(parsed[0]?.contextWindow).toBe(64000);
    expect(parsed[1]?.contextWindow).toBe(32768);
  });

  it("跳过空 id / 非字符串 id", () => {
    const parsed = parseModelsJson({
      data: [
        { id: "ok" },
        { id: "" },
        { id: "  " },
        { id: null },
        { id: 42 },
        {},
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe("ok");
  });

  it("max_output_tokens 为 0 或负数时跳过", () => {
    const parsed = parseModelsJson({
      data: [
        { id: "x", max_output_tokens: 0 },
        { id: "y", max_output_tokens: 8192 },
      ],
    });
    expect(parsed[0]?.maxOutputTokens).toBeUndefined();
    expect(parsed[1]?.maxOutputTokens).toBe(8192);
  });

  it("input_modalities 含未知值时仅保留 text/image", () => {
    const parsed = parseModelsJson({
      data: [{ id: "x", input_modalities: ["text", "audio", "image"] }],
    });
    expect(parsed[0]?.input).toEqual(["text", "image"]);
  });

  it("返回数组按 id 排序", () => {
    const parsed = parseModelsJson({
      data: [{ id: "z" }, { id: "a" }, { id: "m" }],
    });
    expect(parsed.map((m) => m.id)).toEqual(["a", "m", "z"]);
  });
});