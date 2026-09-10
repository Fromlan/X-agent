/**
 * provider-pi-models / model-shape —— 塑形 (issue #68 主题 J C-103).
 *
 * 唯一职责: 把 X-agent `ProviderModelEntry` 塑形成 Pi `models.json` 接受的
 * entry 形态. 不知道 models.json 怎么写盘 / 怎么修 / 怎么去重, 只看单条
 * model entry 怎么"算"出来.
 *
 * 拆出来的好处:
 * - modelEntryForPiModelsJson 是热路径 (syncProfileToPi 每个档案都调), 单独
 *   unit 测不会拖上 repair / dedup 的 IO 副作用.
 * - repair 只在启动路径跑一次, 不需要 import 全部塑形 helper — 但因为
 *   repair 复用 deepseekProxyModelExtras / minimaxModelExtras, 仍 cross-import.
 * - dedup 模块完全不依赖本文件, 保持单向 acyclic.
 */
import type { ProviderApiKind, ProviderModelEntry } from "../../../shared/ipc";
import { enrichModelEntry } from "../../../shared/model-context";

/**
 * OpenAI-completions models whose id mentions DeepSeek need Pi `compat`
 * when the provider is NOT auto-detected as DeepSeek (providerId !==
 * "deepseek" and baseUrl does not include deepseek.com). Without this,
 * thinking/`reasoning_content` replay and prefix-cache stability break on
 * SiliconFlow / OpenRouter / custom relays.
 */
export function looksLikeDeepSeekModelId(modelId: string): boolean {
  return /deepseek/i.test(modelId.trim());
}

/** Pi auto-detects DeepSeek compat from these endpoints. */
export function isPiAutoDetectedDeepSeekEndpoint(
  providerId: string,
  baseUrl: string,
): boolean {
  const id = providerId.trim().toLowerCase();
  const url = baseUrl.trim().toLowerCase();
  return id === "deepseek" || url.includes("deepseek.com");
}

/**
 * MiniMax / MiniMax-M* 模型识别。MiniMax 官方模型 id 形如
 * "MiniMax-M3" / "MiniMax-M2.7" / "MiniMax-M2.7-highspeed" 等；
 * 也兼容 OpenRouter / 第三方网关常见的 "minimax/MiniMax-M3" 形式
 * (经过 VENDOR_PREFIXES 标准化后会落在这里)。
 */
export function looksLikeMiniMaxModelId(modelId: string): boolean {
  return /MiniMax-M\d/i.test(modelId.trim());
}

/** Pi models.json 注入字段，覆盖 reasoning / compat / thinkingLevelMap。 */
export function minimaxModelExtras(modelId: string): {
  reasoning: true;
  compat: { forceAdaptiveThinking: true };
  thinkingLevelMap: Record<string, string | null>;
} | null {
  if (!looksLikeMiniMaxModelId(modelId)) return null;
  const id = modelId.trim().toLowerCase();
  const isM3 = /^MiniMax-M3(\b|[_-])/.test(id) || id.endsWith("-m3");
  if (isM3) {
    // M3：官方 API 只有 adaptive / disabled 二态，Pi 在 forceAdaptiveThinking
    // 路径下所有非 off 级别都发 thinking: {type:"adaptive"}，没有强度差异。
    // 把 UI 收敛到 off / max 二选一，避免给用户 5 个等价的"开"选项。
    return {
      reasoning: true,
      compat: { forceAdaptiveThinking: true },
      thinkingLevelMap: {
        off: "off",
        minimal: null, // M3 无强度差异，Pi 强制收成 max
        low: null,
        medium: null,
        high: null,
        max: "max",
      },
    };
  }
  // M2.x：官方无法关闭（传 disabled 也不生效），模型始终 thinking。
  // 隐藏 off；其它 5 个级别保留（pre-existing UX，UI 提示"在思考中"，
  // 实际服务端对所有非 off 级别都返回 thinking，不影响正确性）。
  return {
    reasoning: true,
    compat: { forceAdaptiveThinking: true },
    thinkingLevelMap: {
      off: null, // 强制从 UI 中隐藏 off（服务端无法关闭）
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      max: "max",
    },
  };
}

/** Model entry fields written into Pi models.json for DeepSeek-family models. */
export function deepseekProxyModelExtras(modelId: string): {
  reasoning: true;
  thinkingLevelMap?: Record<string, string | null>;
  compat: {
    thinkingFormat: "deepseek";
    requiresReasoningContentOnAssistantMessages: true;
  };
} | null {
  if (!looksLikeDeepSeekModelId(modelId)) return null;
  const id = modelId.trim().toLowerCase();
  // Match Pi built-in DeepSeek V4 maps (medium/low/minimal unsupported).
  const isV4 = id.includes("deepseek-v4") || id.includes("deepseek_v4");
  return {
    reasoning: true,
    ...(isV4
      ? {
          thinkingLevelMap: {
            minimal: null,
            low: null,
            medium: null,
            high: "high",
            max: "max",
          },
        }
      : {}),
    compat: {
      thinkingFormat: "deepseek",
      requiresReasoningContentOnAssistantMessages: true,
    },
  };
}

export function modelEntryForPiModelsJson(
  model: ProviderModelEntry,
  api: ProviderApiKind,
  providerId: string,
  baseUrl: string,
): Record<string, unknown> {
  const enriched = enrichModelEntry(model);
  const entry: Record<string, unknown> = {
    id: enriched.id,
    ...(enriched.name ? { name: enriched.name } : {}),
  };
  if (enriched.contextWindow != null) {
    entry.contextWindow = enriched.contextWindow;
  }
  // input 字段与 Pi SDK `Model.input` 对齐。注: Pi SDK 0.83+ `modelFromJson`
  // (provider-composer.js:62) 走 `definition.input ?? ["text"]` —— **不读 bundled 兜底**。
  // 只有 `applyModelOverride` (line 30, 仅用于 modelOverrides) 才走
  // `override.input ?? model.input` 兜底。X-agent 走的是 `applyModelsJson` →
  // `modelFromJson` 路径,所以 bundled vision 模型的 ["text","image"] 不会被自动继承:
  // - undefined → Pi SDK 用 ["text"] 兜底,vision 能力静默丢失
  // - ["text"]   → 显式覆盖,bundled 失效
  // - ["text","image"] → 显式保 vision (X-agent 端由 saveProfile 启发式兜底)
  // X-agent 必须在保存时主动填好 input (UI 走 guessDefaultInput),
  // 不依赖 Pi SDK 的 bundled fallback。
  // 升级 Pi SDK 时回归: Pi 升级可能引入严格 schema 校验。
  if (enriched.input != null && enriched.input.length > 0) {
    entry.input = enriched.input;
  }
  const extras = deepseekProxyModelExtras(enriched.id);
  if (extras) {
    // Custom ids (e.g. deepseek-v4-pro[1M]) do not inherit built-in reasoning;
    // without it Pi clamps every thinking level to off.
    entry.reasoning = extras.reasoning;
    if (extras.thinkingLevelMap) {
      entry.thinkingLevelMap = extras.thinkingLevelMap;
    }
    // Pi auto-detects thinkingFormat on official deepseek.com openai-completions.
    // Still write compat for proxies / anthropic-messages / custom base URLs.
    if (
      api !== "openai-completions" ||
      !isPiAutoDetectedDeepSeekEndpoint(providerId, baseUrl)
    ) {
      entry.compat = extras.compat;
    }
  }
  // MiniMax (anthropic-messages only): inject forceAdaptiveThinking compat so
  // Pi sends thinking: {type:"adaptive"} / {type:"disabled"} instead of the
  // budget_tokens form. Without reasoning+compat, Pi clamps every level to
  // off (issue: thinking strength selector is dead for MiniMax). MiniMax does
  // not have an "auto-detected" baseUrl path — always write compat.
  const minimaxExtras = minimaxModelExtras(enriched.id);
  if (minimaxExtras) {
    entry.reasoning = minimaxExtras.reasoning;
    entry.compat = minimaxExtras.compat;
    entry.thinkingLevelMap = minimaxExtras.thinkingLevelMap;
  }
  return entry;
}
