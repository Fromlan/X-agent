/**
 * Vitest 套件 —— src/lib/model-capability 纯函数。
 *
 * 锁住 5 组不变量 (mistral-conversations adapter 在 user message 含 image
 * 且 model 不收图时,会整条 message 替换为 "(image omitted: model does not
 * support images)" 占位文本 —— X-agent 必须在 send 前挡住):
 * 1. input: ["text", "image"] → modelSupportsImage() = true
 * 2. input: ["text"]          → modelSupportsImage() = false
 * 3. input: undefined         → modelSupportsImage() = false (保守)
 * 4. findCurrentModel() 在 key 缺失 / 不在列表中时返回 null
 * 5. guessDefaultInput() 在 Pi SDK 0.83+ `modelFromJson` 不读 bundled 兜底
 *    的缺口下,正确识别已知 vision 模型
 */
import { describe, it, expect } from "vitest";
import type { ModelInfo } from "@shared/ipc";
import {
  findCurrentModel,
  formatVisionModelExamples,
  guessDefaultInput,
  modelSupportsImage,
  VISION_MODEL_EXAMPLES,
} from "./model-capability";

function mi(
  provider: string,
  id: string,
  input?: ("text" | "image")[],
): ModelInfo {
  return { provider, id, name: `${provider}/${id}`, input };
}

describe("modelSupportsImage", () => {
  const models: ModelInfo[] = [
    mi("mistral", "mistral-small-2603", ["text", "image"]),
    mi("mistral", "mistral-small-latest", ["text", "image"]),
    mi("mistral", "pixtral-12b", ["text", "image"]),
    mi("mistral", "mistral-large-2411", ["text"]),
    mi("mistral", "codestral-latest", ["text"]),
    mi("anthropic", "claude-sonnet-4-5", ["text", "image"]),
    mi("custom", "unknown-input", undefined),
  ];

  it("input 含 'image' → 支持", () => {
    expect(modelSupportsImage(models, "mistral/mistral-small-2603")).toBe(true);
    expect(modelSupportsImage(models, "mistral/pixtral-12b")).toBe(true);
    expect(modelSupportsImage(models, "anthropic/claude-sonnet-4-5")).toBe(true);
  });

  it("input 仅 'text' → 不支持", () => {
    expect(modelSupportsImage(models, "mistral/mistral-large-2411")).toBe(
      false,
    );
    expect(modelSupportsImage(models, "mistral/codestral-latest")).toBe(false);
  });

  it("input 缺省 → 保守按不收图对待 (不假设支持)", () => {
    expect(modelSupportsImage(models, "custom/unknown-input")).toBe(false);
  });

  it("key 为 null / undefined / 空串 → 不支持", () => {
    expect(modelSupportsImage(models, null)).toBe(false);
    expect(modelSupportsImage(models, undefined)).toBe(false);
    expect(modelSupportsImage(models, "")).toBe(false);
  });

  it("key 不在列表中 → 不支持 (不臆造支持)", () => {
    expect(modelSupportsImage(models, "openai/gpt-4o-not-in-list")).toBe(false);
  });
});

describe("findCurrentModel", () => {
  const models: ModelInfo[] = [
    mi("anthropic", "claude-sonnet-4-5", ["text", "image"]),
    mi("mistral", "pixtral-12b", ["text", "image"]),
  ];

  it("命中 → 返回完整 ModelInfo", () => {
    const m = findCurrentModel(models, "anthropic/claude-sonnet-4-5");
    expect(m).not.toBeNull();
    expect(m?.provider).toBe("anthropic");
    expect(m?.id).toBe("claude-sonnet-4-5");
    expect(m?.input).toEqual(["text", "image"]);
  });

  it("未命中 → null", () => {
    expect(findCurrentModel(models, "openai/gpt-4o")).toBeNull();
  });

  it("key 为 null / undefined / 空串 → null", () => {
    expect(findCurrentModel(models, null)).toBeNull();
    expect(findCurrentModel(models, undefined)).toBeNull();
    expect(findCurrentModel(models, "")).toBeNull();
  });
});

describe("VISION_MODEL_EXAMPLES / formatVisionModelExamples", () => {
  it("清单非空, 至少含 4 个常见 vision 能力模型", () => {
    expect(VISION_MODEL_EXAMPLES.length).toBeGreaterThanOrEqual(4);
    expect(VISION_MODEL_EXAMPLES).toContain("pixtral-12b");
    expect(VISION_MODEL_EXAMPLES).toContain("Claude");
    expect(VISION_MODEL_EXAMPLES).toContain("GPT-4o");
    expect(VISION_MODEL_EXAMPLES).toContain("Gemini");
  });

  it("formatVisionModelExamples 用 ' / ' 拼接, 两侧不加括号", () => {
    const out = formatVisionModelExamples();
    expect(out.startsWith("(")).toBe(false);
    expect(out.endsWith(")")).toBe(false);
    expect(out).toContain(" / ");
    // 完整 token 数 = len(elements) + len(" / ") * (n - 1)
    const expected = VISION_MODEL_EXAMPLES.join(" / ");
    expect(out).toBe(expected);
  });
});

describe("guessDefaultInput —— 启发式兜底 Pi SDK bundled vision", () => {
  it("OpenAI 多模态 (gpt-4o / 4.1 / 5 / o1 / o3 / o4-mini) → vision", () => {
    expect(guessDefaultInput("gpt-4o")).toEqual(["text", "image"]);
    expect(guessDefaultInput("gpt-4o-mini")).toEqual(["text", "image"]);
    expect(guessDefaultInput("gpt-4o-2024-08-06")).toEqual(["text", "image"]);
    expect(guessDefaultInput("gpt-4.1")).toEqual(["text", "image"]);
    expect(guessDefaultInput("gpt-4.1-mini")).toEqual(["text", "image"]);
    expect(guessDefaultInput("gpt-4-turbo")).toEqual(["text", "image"]);
    expect(guessDefaultInput("gpt-5")).toEqual(["text", "image"]);
    expect(guessDefaultInput("gpt-5-mini")).toEqual(["text", "image"]);
    expect(guessDefaultInput("o1")).toEqual(["text", "image"]);
    expect(guessDefaultInput("o1-mini")).toEqual(["text", "image"]);
    expect(guessDefaultInput("o1-pro")).toEqual(["text", "image"]);
    expect(guessDefaultInput("o3")).toEqual(["text", "image"]);
    expect(guessDefaultInput("o3-pro")).toEqual(["text", "image"]);
    expect(guessDefaultInput("o4-mini")).toEqual(["text", "image"]);
  });

  it("OpenAI 例外: o3-mini 不收图 → text", () => {
    expect(guessDefaultInput("o3-mini")).toEqual(["text"]);
  });

  it("Anthropic 多模态 (claude-3+ / 4+ / 5 / fable) → vision", () => {
    expect(guessDefaultInput("claude-3-haiku-20240307")).toEqual([
      "text",
      "image",
    ]);
    expect(guessDefaultInput("claude-3-5-sonnet-20241022")).toEqual([
      "text",
      "image",
    ]);
    expect(guessDefaultInput("claude-sonnet-4-5")).toEqual([
      "text",
      "image",
    ]);
    expect(guessDefaultInput("claude-opus-4-1")).toEqual(["text", "image"]);
    expect(guessDefaultInput("claude-fable-5")).toEqual(["text", "image"]);
  });

  it("Google Gemini (1.5+ / 2 / 3) → vision", () => {
    expect(guessDefaultInput("gemini-1.5-pro")).toEqual(["text", "image"]);
    expect(guessDefaultInput("gemini-2.0-flash")).toEqual(["text", "image"]);
    expect(guessDefaultInput("gemini-2.5-pro")).toEqual(["text", "image"]);
  });

  it("Mistral vision (pixtral / small / medium) → vision", () => {
    expect(guessDefaultInput("pixtral-12b")).toEqual(["text", "image"]);
    expect(guessDefaultInput("mistral-small-2603")).toEqual([
      "text",
      "image",
    ]);
    expect(guessDefaultInput("mistral-medium-latest")).toEqual([
      "text",
      "image",
    ]);
  });

  it("Mistral 非 vision (large / codestral) → text", () => {
    expect(guessDefaultInput("mistral-large-2411")).toEqual(["text"]);
    expect(guessDefaultInput("codestral-latest")).toEqual(["text"]);
  });

  it("MiniMax-M3 (官方 vision) → vision; M2.x → text", () => {
    expect(guessDefaultInput("MiniMax-M3")).toEqual(["text", "image"]);
    expect(guessDefaultInput("MiniMax-M2.7")).toEqual(["text"]);
    expect(guessDefaultInput("MiniMax-M2.7-highspeed")).toEqual(["text"]);
  });

  it("llama vision / qwen-vl → vision", () => {
    expect(guessDefaultInput("llama-3.2-90b-vision")).toEqual([
      "text",
      "image",
    ]);
    expect(guessDefaultInput("qwen2-vl-72b")).toEqual(["text", "image"]);
    expect(guessDefaultInput("qwen2.5-vl-72b")).toEqual(["text", "image"]);
  });

  it("通用 pattern: 名字含 vision / -vl → vision", () => {
    expect(guessDefaultInput("custom-vision-model")).toEqual([
      "text",
      "image",
    ]);
    expect(guessDefaultInput("internvl2-26b")).toEqual(["text", "image"]);
  });

  it("未知 / 纯文本模型 → 保守 text", () => {
    expect(guessDefaultInput("deepseek-v3")).toEqual(["text"]);
    expect(guessDefaultInput("kimi-k2")).toEqual(["text"]);
    expect(guessDefaultInput("gpt-3.5-turbo")).toEqual(["text"]); // 不在多模态 pattern
    expect(guessDefaultInput("text-embedding-3-small")).toEqual(["text"]);
  });

  it("空 / 空白 id → text", () => {
    expect(guessDefaultInput("")).toEqual(["text"]);
    expect(guessDefaultInput("   ")).toEqual(["text"]);
  });

  it("大小写不敏感", () => {
    expect(guessDefaultInput("GPT-4O")).toEqual(["text", "image"]);
    expect(guessDefaultInput("Claude-Sonnet-4-5")).toEqual(["text", "image"]);
  });

  it("id 前后空白 trim 后再匹配", () => {
    expect(guessDefaultInput("  gpt-4o  ")).toEqual(["text", "image"]);
  });
});