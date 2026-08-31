/**
 * Vitest 套件 —— src/lib/model-capability 纯函数。
 *
 * 锁住 4 个不变量 (mistral-conversations adapter 在 user message 含 image
 * 且 model 不收图时,会整条 message 替换为 "(image omitted: model does not
 * support images)" 占位文本 —— X-agent 必须在 send 前挡住):
 * 1. input: ["text", "image"] → modelSupportsImage() = true
 * 2. input: ["text"]          → modelSupportsImage() = false
 * 3. input: undefined         → modelSupportsImage() = false (保守)
 * 4. findCurrentModel() 在 key 缺失 / 不在列表中时返回 null
 */
import { describe, it, expect } from "vitest";
import type { ModelInfo } from "@shared/ipc";
import {
  findCurrentModel,
  formatVisionModelExamples,
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
