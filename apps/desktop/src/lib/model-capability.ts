/**
 * Model capability helpers — 决定当前 model 是否能接收图片。
 *
 * 背景:Pi SDK 的 `mistral-conversations` provider 会基于 `Model.input`
 * 在 user message 含 image 时把整条 message 替换为
 * `(image omitted: model does not support images)` 占位文本,
 * 造成"截图已发但 AI 看不到"。X-agent 必须在 send 前能判断当前 model
 * 是否支持 image,并在 chip 区 / send 闸门处给用户明确反馈。
 */
import type { ModelInfo, ModelInput } from "@shared/ipc";

/** 当前 model 是否收 image。`input === undefined` 时返回 false (保守)。 */
export function modelSupportsImage(
  models: ReadonlyArray<ModelInfo>,
  key: string | null | undefined,
): boolean {
  if (!key) return false;
  const m = models.find((x) => `${x.provider}/${x.id}` === key);
  if (!m) return false;
  return Array.isArray(m.input) && m.input.includes("image");
}

/** 拿当前 model 的完整 ModelInfo(给 chip 提示文案用)。返回 null 表示未选中。 */
export function findCurrentModel(
  models: ReadonlyArray<ModelInfo>,
  key: string | null | undefined,
): ModelInfo | null {
  if (!key) return null;
  return models.find((x) => `${x.provider}/${x.id}` === key) ?? null;
}

export const VISION_MODEL_EXAMPLES: readonly string[] = [
  "mistral-small-2603",
  "pixtral-12b",
  "mistral-medium-latest",
  "Claude",
  "GPT-4o",
  "Gemini",
] as const;

export function formatVisionModelExamples(): string {
  return VISION_MODEL_EXAMPLES.join(" / ");
}

/**
 * 已知 vision 模型名 pattern (来自 Pi SDK bundled data + 公开模型目录)。
 * 命中的 id 启发式返回 `["text", "image"]`;不命中返回 `["text"]` (保守)。
 * `NON_VISION_MODEL_OVERRIDES` 用来盖掉同家族的例外 (如 o3-mini)。
 * 升级 Pi SDK 时回归:本表是"广覆盖 + 安全默认"的实用平衡,不追求穷举。
 */
const VISION_MODEL_PATTERNS: readonly RegExp[] = [
  // OpenAI 多模态 (gpt-3.5 / gpt-4 (无后缀) / o3-mini 不在表内)
  /^gpt-4o(\b|[-_])/i,
  /^gpt-4\.1(\b|[-_])/i,
  /^gpt-4-turbo/i,
  /^gpt-5(\b|[-_])/i,
  /^o1(\b|[-_])/i,
  /^o3-pro(\b|[-_])/i,
  /^o3(\b|[-_])/i,
  /^o4-mini(\b|[-_])/i,
  // Anthropic 多模态 — bundled 内 claude-* 全是 vision,宽松匹配开头即可
  /^claude(\b|[-_])/i,
  // Google Gemini 多模态
  /^gemini[-_]?(1\.5|2|3)/i,
  // Mistral vision
  /^pixtral/i,
  /^mistral[-_]?(small|medium)/i,
  // MiniMax (官方 M3 是 vision,M2.x 不在 bundled 列)
  /^MiniMax[-_]?M3/i,
  // Meta llama vision
  /^llama[-_]?3\.2[-_]?vision/i,
  // Alibaba Qwen VL (含 qwen2-vl / qwen2.5-vl / qwen-vl)
  /^qwen[-_]?(vl|2[-_.]vl|2\.5[-_.]vl)/i,
  // 通用兜底: 名字含 vision / vl (含 vl2- / -vl-)
  /vision/i,
  /vl(\d|[-_]|\b)/i,
];

const NON_VISION_MODEL_OVERRIDES: readonly RegExp[] = [
  /^o3-mini(\b|[-_])/i,
];

/**
 * 用户在 chip 未表态 (input === undefined) 时,落 Pi models.json 前的
 * 启发式默认 input。命中 vision pattern → ["text", "image"];否则 ["text"]。
 * 弥补 Pi SDK 0.83+ `modelFromJson` 用 `definition.input ?? ["text"]`
 * 不读 bundled 兜底的缺口。
 */
export function guessDefaultInput(modelId: string): ModelInput[] {
  const id = modelId.trim();
  if (!id) return ["text"];
  for (const re of NON_VISION_MODEL_OVERRIDES) {
    if (re.test(id)) return ["text"];
  }
  for (const re of VISION_MODEL_PATTERNS) {
    if (re.test(id)) return ["text", "image"];
  }
  return ["text"];
}
