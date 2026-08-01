import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ProviderActivateResult,
  ProviderApiKind,
  ProviderImportResult,
  ProviderModelEntry,
  ProviderPreset,
  ProviderProfile,
  ProviderProfileSummary,
  ProviderUpsertInput,
} from "../../shared/ipc";
import {
  enrichModelEntry,
  normalizePositiveInt,
} from "../../shared/model-context";
import { getAgentDirPath, patchPrefs } from "./prefs";
import { decryptSecret, encryptSecret } from "./secret-codec";

const nodeRequire = createRequire(import.meta.url);

export interface ProviderStoreFile {
  version: 1;
  activeId: string | null;
  profiles: ProviderProfile[];
}

export interface ProviderPaths {
  agentDir: string;
  storePath: string;
  authPath: string;
  modelsPath: string;
}

const API_KINDS: ProviderApiKind[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

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

function modelEntryForPiModelsJson(
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
  return entry;
}

/**
 * Patch existing ~/.pi/agent/models.json DeepSeek entries that lack `reasoning`.
 * Custom ids (e.g. deepseek-v4-pro[1M]) written before this fix clamp thinking to off.
 * Returns true when the file was rewritten.
 */
export function repairDeepSeekModelsJson(
  paths: ProviderPaths = defaultProviderPaths(),
): boolean {
  if (!existsSync(paths.modelsPath)) return false;
  let modelsFile: { providers?: Record<string, unknown> };
  try {
    modelsFile = JSON.parse(readFileSync(paths.modelsPath, "utf8")) as {
      providers?: Record<string, unknown>;
    };
  } catch {
    return false;
  }
  const providers = modelsFile.providers;
  if (!providers || typeof providers !== "object") return false;

  let changed = false;
  for (const [providerId, rawProvider] of Object.entries(providers)) {
    if (!rawProvider || typeof rawProvider !== "object") continue;
    const provider = rawProvider as {
      baseUrl?: string;
      api?: string;
      models?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(provider.models)) continue;
    const api = (
      API_KINDS.includes(provider.api as ProviderApiKind)
        ? provider.api
        : "openai-completions"
    ) as ProviderApiKind;
    const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl : "";

    provider.models = provider.models.map((model) => {
      const id = typeof model.id === "string" ? model.id : "";
      if (!id || !looksLikeDeepSeekModelId(id)) return model;
      const extras = deepseekProxyModelExtras(id);
      if (!extras) return model;
      const next = { ...model };
      if (next.reasoning !== true) {
        next.reasoning = true;
        changed = true;
      }
      if (
        extras.thinkingLevelMap &&
        (next.thinkingLevelMap == null ||
          typeof next.thinkingLevelMap !== "object")
      ) {
        next.thinkingLevelMap = extras.thinkingLevelMap;
        changed = true;
      }
      const needsCompat =
        api !== "openai-completions" ||
        !isPiAutoDetectedDeepSeekEndpoint(providerId, baseUrl);
      if (needsCompat && next.compat == null) {
        next.compat = extras.compat;
        changed = true;
      }
      return next;
    });
    providers[providerId] = provider;
  }

  if (!changed) return false;
  writeFileSync(paths.modelsPath, JSON.stringify(modelsFile, null, 2), "utf8");
  return true;
}

export function defaultProviderPaths(): ProviderPaths {
  const agentDir = getAgentDirPath();
  return {
    agentDir,
    storePath: join(agentDir, "x-agent-providers.json"),
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  };
}

export function listProviderPresets(): ProviderPreset[] {
  return rawProviderPresets().map((preset) => ({
    ...preset,
    models: preset.models.map((m) => enrichModelEntry(m)),
  }));
}

function rawProviderPresets(): ProviderPreset[] {
  return [
    // —— 国内官方 / 主流 ——
    {
      id: "deepseek",
      name: "DeepSeek",
      // 必须与 deepseek-anthropic 使用不同 providerId。
      // Pi auth/models.json 的键空间就是 providerId，没有 api 维度 namespace；
      // 若两者共用 providerId，激活其中一个会覆盖另一个的 key。
      providerId: "deepseek",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com",
      models: [
        { id: "deepseek-chat", name: "DeepSeek Chat" },
        { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
        { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
      ],
      notes: "DeepSeek OpenAI-compatible（参考 cc-switch）",
      category: "cn",
      websiteUrl: "https://platform.deepseek.com",
    },
    {
      id: "deepseek-anthropic",
      name: "DeepSeek (Anthropic)",
      // 与 openai-completions 预设解耦的独立 providerId，
      // 避免激活 deepseek-anthropic 时覆盖 Pi 中的 deepseek OpenAI key。
      providerId: "deepseek-anthropic",
      api: "anthropic-messages",
      baseUrl: "https://api.deepseek.com/anthropic",
      models: [
        { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
        { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      ],
      notes: "DeepSeek Anthropic 兼容层",
      category: "cn",
      websiteUrl: "https://platform.deepseek.com",
    },
    {
      id: "kimi",
      name: "Kimi",
      providerId: "kimi",
      api: "anthropic-messages",
      baseUrl: "https://api.moonshot.cn/anthropic",
      models: [{ id: "kimi-k2.7-code", name: "Kimi K2.7 Code" }],
      notes: "月之暗面 Kimi Anthropic 兼容",
      category: "cn",
      websiteUrl: "https://platform.moonshot.cn",
    },
    {
      id: "kimi-coding",
      name: "Kimi For Coding",
      providerId: "kimi",
      api: "anthropic-messages",
      baseUrl: "https://api.kimi.com/coding/",
      models: [{ id: "kimi-for-coding", name: "Kimi For Coding" }],
      notes: "Kimi 编程专用端点",
      category: "cn",
      websiteUrl: "https://www.kimi.com/code",
    },
    {
      id: "zhipu",
      name: "智谱 GLM",
      providerId: "zhipu",
      api: "anthropic-messages",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      models: [{ id: "glm-5.1", name: "GLM-5.1" }],
      notes: "智谱 BigModel Anthropic 兼容",
      category: "cn",
      websiteUrl: "https://open.bigmodel.cn",
    },
    {
      id: "zhipu-en",
      name: "智谱 GLM (国际)",
      providerId: "zhipu",
      api: "anthropic-messages",
      baseUrl: "https://api.z.ai/api/anthropic",
      models: [{ id: "glm-5.1", name: "GLM-5.1" }],
      notes: "Z.ai 国际站",
      category: "cn",
      websiteUrl: "https://z.ai",
    },
    {
      id: "bailian",
      name: "阿里云百炼",
      providerId: "bailian",
      api: "anthropic-messages",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      models: [{ id: "qwen-plus", name: "Qwen Plus" }],
      notes: "DashScope Anthropic 兼容",
      category: "cn",
      websiteUrl: "https://bailian.console.aliyun.com",
    },
    {
      id: "bailian-coding",
      name: "百炼 Coding",
      providerId: "bailian",
      api: "anthropic-messages",
      baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
      models: [{ id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" }],
      notes: "百炼编程专用端点",
      category: "cn",
      websiteUrl: "https://bailian.console.aliyun.com",
    },
    {
      id: "minimax",
      name: "MiniMax",
      providerId: "minimax",
      api: "anthropic-messages",
      baseUrl: "https://api.minimaxi.com/anthropic",
      models: [{ id: "MiniMax-M2.7", name: "MiniMax M2.7" }],
      notes: "MiniMax 国内 Anthropic 兼容",
      category: "cn",
      websiteUrl: "https://platform.minimaxi.com",
    },
    {
      id: "minimax-en",
      name: "MiniMax (国际)",
      providerId: "minimax",
      api: "anthropic-messages",
      baseUrl: "https://api.minimax.io/anthropic",
      models: [{ id: "MiniMax-M2.7", name: "MiniMax M2.7" }],
      notes: "MiniMax 国际站",
      category: "cn",
      websiteUrl: "https://platform.minimax.io",
    },
    {
      id: "stepfun",
      name: "阶跃星辰",
      providerId: "stepfun",
      api: "anthropic-messages",
      baseUrl: "https://api.stepfun.com/step_plan",
      models: [{ id: "step-3.5-flash-2603", name: "Step 3.5 Flash" }],
      notes: "StepFun Step Plan",
      category: "cn",
      websiteUrl: "https://platform.stepfun.com",
    },
    {
      id: "longcat",
      name: "LongCat",
      providerId: "longcat",
      api: "anthropic-messages",
      baseUrl: "https://api.longcat.chat/anthropic",
      models: [{ id: "LongCat-2.0", name: "LongCat 2.0" }],
      notes: "LongCat Anthropic 兼容",
      category: "cn",
      websiteUrl: "https://longcat.chat/platform",
    },
    {
      id: "xiaomi-mimo",
      name: "小米 MiMo",
      providerId: "xiaomi-mimo",
      api: "anthropic-messages",
      baseUrl: "https://api.xiaomimimo.com/anthropic",
      models: [{ id: "mimo-v2-flash", name: "MiMo V2 Flash" }],
      notes: "小米 MiMo Anthropic 兼容",
      category: "cn",
      websiteUrl: "https://platform.xiaomimimo.com",
    },
    {
      id: "doubao",
      name: "豆包 Seed",
      providerId: "doubao",
      api: "anthropic-messages",
      baseUrl: "https://ark.cn-beijing.volces.com/api/compatible",
      models: [{ id: "doubao-seed-1-8-251228", name: "Doubao Seed" }],
      notes: "火山方舟兼容端点",
      category: "cn",
      websiteUrl: "https://console.volcengine.com/ark",
    },
    {
      id: "bailing",
      name: "百灵",
      providerId: "bailing",
      api: "anthropic-messages",
      baseUrl: "https://api.tbox.cn/api/anthropic",
      models: [{ id: "Ling-1T", name: "Ling-1T" }],
      notes: "BaiLing Anthropic 兼容",
      category: "cn",
      websiteUrl: "https://tbox.cn",
    },
    {
      id: "qianfan-coding",
      name: "百度千帆 Coding",
      providerId: "qianfan",
      api: "anthropic-messages",
      baseUrl: "https://qianfan.baidubce.com/anthropic/coding",
      models: [{ id: "qianfan-code-latest", name: "Qianfan Code" }],
      notes: "百度千帆编程计划",
      category: "cn",
      websiteUrl: "https://cloud.baidu.com/product/qianfan_modelbuilder",
    },

    // —— 聚合 / 中转 ——
    {
      id: "siliconflow",
      name: "SiliconFlow",
      providerId: "siliconflow",
      api: "openai-completions",
      baseUrl: "https://api.siliconflow.cn/v1",
      models: [
        { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
        { id: "Qwen/Qwen3-235B-A22B", name: "Qwen3 235B" },
      ],
      notes:
        "硅基流动 OpenAI 兼容。含 DeepSeek 模型时会写入 Pi deepseek compat（thinking / reasoning_content），因 baseUrl 非 api.deepseek.com。",
      category: "aggregator",
      websiteUrl: "https://cloud.siliconflow.cn",
    },
    {
      id: "siliconflow-en",
      name: "SiliconFlow (国际)",
      providerId: "siliconflow",
      api: "openai-completions",
      baseUrl: "https://api.siliconflow.com/v1",
      models: [{ id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" }],
      notes:
        "硅基流动国际站。DeepSeek 模型激活时自动写入 Pi deepseek compat。",
      category: "aggregator",
      websiteUrl: "https://cloud.siliconflow.com",
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      providerId: "openrouter",
      api: "openai-completions",
      baseUrl: "https://openrouter.ai/api/v1",
      models: [
        { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
        { id: "openai/gpt-4o", name: "GPT-4o" },
      ],
      notes: "OpenRouter 聚合路由",
      category: "aggregator",
      websiteUrl: "https://openrouter.ai",
    },
    {
      id: "aihubmix",
      name: "AiHubMix",
      providerId: "aihubmix",
      api: "anthropic-messages",
      baseUrl: "https://aihubmix.com",
      models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet" }],
      notes: "AiHubMix 聚合",
      category: "aggregator",
      websiteUrl: "https://aihubmix.com",
    },
    {
      id: "dmxapi",
      name: "DMXAPI",
      providerId: "dmxapi",
      api: "anthropic-messages",
      baseUrl: "https://www.dmxapi.cn",
      models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet" }],
      notes: "DMXAPI 中转",
      category: "aggregator",
      websiteUrl: "https://www.dmxapi.cn",
    },
    {
      id: "modelscope",
      name: "ModelScope",
      providerId: "modelscope",
      api: "anthropic-messages",
      baseUrl: "https://api-inference.modelscope.cn",
      models: [{ id: "ZhipuAI/GLM-5.1", name: "GLM-5.1" }],
      notes: "魔搭社区推理",
      category: "aggregator",
      websiteUrl: "https://modelscope.cn",
    },
    {
      id: "novita",
      name: "Novita AI",
      providerId: "novita",
      api: "anthropic-messages",
      baseUrl: "https://api.novita.ai/anthropic",
      models: [{ id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2" }],
      notes: "Novita Anthropic 兼容",
      category: "aggregator",
      websiteUrl: "https://novita.ai",
    },
    {
      id: "nvidia",
      name: "NVIDIA NIM",
      providerId: "nvidia",
      api: "openai-completions",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      models: [{ id: "meta/llama-3.1-70b-instruct", name: "Llama 3.1 70B" }],
      notes: "NVIDIA API catalog",
      category: "aggregator",
      websiteUrl: "https://build.nvidia.com",
    },
    {
      id: "packycode",
      name: "PackyCode",
      providerId: "packycode",
      api: "anthropic-messages",
      baseUrl: "https://www.packyapi.ai",
      models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet" }],
      notes: "PackyCode 中转",
      category: "aggregator",
      websiteUrl: "https://www.packyapi.ai",
    },

    // —— 官方 / 通用兼容 ——
    {
      id: "openai",
      name: "OpenAI",
      providerId: "openai",
      api: "openai-completions",
      baseUrl: "https://api.openai.com/v1",
      models: [
        { id: "gpt-4o", name: "GPT-4o" },
        { id: "gpt-4.1", name: "GPT-4.1" },
      ],
      notes: "OpenAI 官方",
      category: "official",
      websiteUrl: "https://platform.openai.com",
    },
    {
      id: "anthropic",
      name: "Anthropic",
      providerId: "anthropic",
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      models: [
        { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        { id: "claude-opus-4-5", name: "Claude Opus 4.5" },
      ],
      notes: "Anthropic 官方",
      category: "official",
      websiteUrl: "https://console.anthropic.com",
    },
    {
      id: "google",
      name: "Google Gemini",
      providerId: "google",
      api: "google-generative-ai",
      baseUrl: "https://generativelanguage.googleapis.com",
      models: [
        { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
        { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      ],
      notes: "Google Generative AI",
      category: "official",
      websiteUrl: "https://aistudio.google.com",
    },
    {
      id: "openai-compatible",
      name: "OpenAI Compatible",
      providerId: "openai-compatible",
      api: "openai-completions",
      baseUrl: "https://api.openai.com/v1",
      models: [{ id: "gpt-4o", name: "GPT-4o" }],
      notes: "通用 OpenAI Chat Completions 兼容网关",
      category: "compatible",
    },
    {
      id: "anthropic-compatible",
      name: "Anthropic Compatible",
      providerId: "anthropic",
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet" }],
      notes: "Anthropic Messages / 兼容中转",
      category: "compatible",
    },
    {
      id: "custom",
      name: "自定义空白",
      providerId: "custom",
      api: "openai-completions",
      baseUrl: "https://example.com/v1",
      models: [{ id: "my-model" }],
      notes: "自行填写 endpoint 与模型",
      category: "custom",
    },
  ];
}

function emptyStore(): ProviderStoreFile {
  return { version: 1, activeId: null, profiles: [] };
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function ensureParent(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function loadStore(paths: ProviderPaths): ProviderStoreFile {
  ensureParent(paths.storePath);
  const raw = readJsonFile<Partial<ProviderStoreFile>>(paths.storePath, emptyStore());
  const profiles = (Array.isArray(raw.profiles) ? raw.profiles : []).map(
    (p) => ({
      ...p,
      apiKey: decryptSecret(typeof p.apiKey === "string" ? p.apiKey : ""),
    }),
  );
  return {
    version: 1,
    activeId: raw.activeId ?? null,
    profiles,
  };
}

function saveStore(paths: ProviderPaths, store: ProviderStoreFile): void {
  ensureParent(paths.storePath);
  const serialized: ProviderStoreFile = {
    ...store,
    profiles: store.profiles.map((p) => ({
      ...p,
      apiKey: encryptSecret(p.apiKey),
    })),
  };
  writeFileSync(paths.storePath, JSON.stringify(serialized, null, 2), "utf8");
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "(未设置)";
  if (trimmed.length <= 8) return "••••";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function validateUpsert(input: ProviderUpsertInput): string | null {
  if (!input.name.trim()) return "名称不能为空";
  if (!/^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/i.test(input.providerId.trim())) {
    return "providerId 须为字母数字/_/-";
  }
  if (!API_KINDS.includes(input.api)) return "不支持的 API 类型";
  if (!input.baseUrl.trim()) return "baseUrl 不能为空";
  try {
    // eslint-disable-next-line no-new
    new URL(input.baseUrl.trim());
  } catch {
    return "baseUrl 不是合法 URL";
  }
  if (!input.apiKey.trim()) return "API Key 不能为空";
  if (!input.models.length || !input.models.some((m) => m.id.trim())) {
    return "至少需要一个模型 id";
  }
  return null;
}

function toSummary(
  profile: ProviderProfile,
  activeId: string | null,
): ProviderProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId,
    api: profile.api,
    baseUrl: profile.baseUrl,
    modelCount: profile.models.length,
    active: profile.id === activeId,
    updatedAt: profile.updatedAt,
    apiKeyHint: maskApiKey(profile.apiKey),
  };
}

export function listProviderProfiles(
  paths: ProviderPaths = defaultProviderPaths(),
): ProviderProfileSummary[] {
  // First launch: seed profiles from Pi auth/models and cc-switch if present.
  if (!existsSync(paths.storePath)) {
    importExistingProviderProfiles(paths);
  }
  const store = loadStore(paths);
  return store.profiles
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((p) => toSummary(p, store.activeId));
}

export function getProviderProfile(
  id: string,
  paths: ProviderPaths = defaultProviderPaths(),
): ProviderProfile | null {
  const store = loadStore(paths);
  return store.profiles.find((p) => p.id === id) ?? null;
}

export function upsertProviderProfile(
  input: ProviderUpsertInput,
  paths: ProviderPaths = defaultProviderPaths(),
): {
  ok: boolean;
  profile?: ProviderProfile;
  error?: string;
  /** True when an already-active profile was rewritten into Pi auth/models. */
  syncedActive?: boolean;
} {
  const err = validateUpsert(input);
  if (err) return { ok: false, error: err };

  const store = loadStore(paths);
  const now = new Date().toISOString();
  const models = input.models
    .map((m) => {
      const id = m.id.trim();
      if (!id) return null;
      const name = m.name?.trim();
      const explicit = normalizePositiveInt(m.contextWindow);
      return enrichModelEntry({
        id,
        ...(name ? { name } : {}),
        ...(explicit != null ? { contextWindow: explicit } : {}),
      });
    })
    .filter((m): m is ProviderModelEntry => !!m);

  if (input.id) {
    const idx = store.profiles.findIndex((p) => p.id === input.id);
    if (idx < 0) return { ok: false, error: "档案不存在" };
    const next: ProviderProfile = {
      ...store.profiles[idx],
      name: input.name.trim(),
      providerId: input.providerId.trim(),
      api: input.api,
      baseUrl: input.baseUrl.trim().replace(/\/$/, ""),
      apiKey: input.apiKey.trim(),
      models,
      notes: input.notes?.trim() || undefined,
      updatedAt: now,
    };
    store.profiles[idx] = next;
    // 编辑已激活档案时,同步刷新 prefs 与 Pi auth/models.json，
    // 避免「档案已改、顶栏仍是编辑前模型列表」。
    if (store.activeId === next.id) {
      saveStore(paths, store);
      const synced = activateProviderProfile(next.id, paths, {
        updatePrefs: true,
      });
      if (!synced.ok) {
        return { ok: false, error: synced.error ?? "同步启用配置失败" };
      }
      return { ok: true, profile: next, syncedActive: true };
    }
    saveStore(paths, store);
    return { ok: true, profile: next };
  }

  const profile: ProviderProfile = {
    id: randomUUID(),
    name: input.name.trim(),
    providerId: input.providerId.trim(),
    api: input.api,
    baseUrl: input.baseUrl.trim().replace(/\/$/, ""),
    apiKey: input.apiKey.trim(),
    models,
    notes: input.notes?.trim() || undefined,
    updatedAt: now,
  };
  store.profiles.push(profile);
  saveStore(paths, store);
  return { ok: true, profile };
}

export function deleteProviderProfile(
  id: string,
  paths: ProviderPaths = defaultProviderPaths(),
): { ok: boolean; error?: string } {
  const store = loadStore(paths);
  const idx = store.profiles.findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: "档案不存在" };
  if (store.activeId === id) {
    return { ok: false, error: "请先启用其他订阅，或停用后再删除当前启用项" };
  }
  store.profiles.splice(idx, 1);
  saveStore(paths, store);
  return { ok: true };
}

export function deactivateProviderProfile(
  paths: ProviderPaths = defaultProviderPaths(),
): void {
  const store = loadStore(paths);
  store.activeId = null;
  saveStore(paths, store);
}

/**
 * Remove models.json / auth.json keys that would shadow the active provider:
 * - exact previous providerId (after rename)
 * - case-insensitive duplicates of keepProviderId (e.g. DeepSeek vs deepseek)
 */
export function pruneStaleProviderKeys(
  providers: Record<string, unknown>,
  keepProviderId: string,
  alsoRemove: readonly string[] = [],
): string[] {
  const keep = keepProviderId.trim();
  if (!keep) return [];
  const keepLower = keep.toLowerCase();
  const removeExact = new Set(
    alsoRemove.map((k) => k.trim()).filter((k) => k && k !== keep),
  );
  const removed: string[] = [];
  for (const key of Object.keys(providers)) {
    if (key === keep) continue;
    if (removeExact.has(key) || key.toLowerCase() === keepLower) {
      delete providers[key];
      removed.push(key);
    }
  }
  return removed;
}

/** UI list: collapse case-variant provider duplicates, prefer preferredProvider. */
export function dedupeModelInfosForUi<
  T extends { provider: string; id: string },
>(models: readonly T[], preferredProvider: string | null | undefined): T[] {
  const preferred = preferredProvider?.trim() ?? "";
  const byKey = new Map<string, T>();
  for (const m of models) {
    const key = `${m.provider.toLowerCase()}/${m.id.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, m);
      continue;
    }
    if (preferred && m.provider === preferred && existing.provider !== preferred) {
      byKey.set(key, m);
    }
  }
  return [...byKey.values()];
}

/**
 * Write profile into Pi auth.json + models.json and mark active.
 * Does not reload ModelRuntime — caller should.
 */
export function activateProviderProfile(
  id: string,
  paths: ProviderPaths = defaultProviderPaths(),
  options?: { updatePrefs?: boolean },
): ProviderActivateResult {
  const store = loadStore(paths);
  const profile = store.profiles.find((p) => p.id === id);
  if (!profile) return { ok: false, error: "档案不存在" };
  if (!profile.apiKey.trim()) return { ok: false, error: "API Key 为空" };
  const primary = profile.models[0];
  if (!primary?.id) return { ok: false, error: "档案没有可用模型" };

  ensureParent(paths.authPath);
  ensureParent(paths.modelsPath);

  const auth = readJsonFile<Record<string, unknown>>(paths.authPath, {});
  // Drop DeepSeek vs deepseek style shadows only — never remove a different
  // providerId (e.g. deepseek vs deepseek-anthropic must coexist).
  pruneStaleProviderKeys(auth, profile.providerId);
  auth[profile.providerId] = {
    type: "api_key",
    key: profile.apiKey,
  };
  writeFileSync(paths.authPath, JSON.stringify(auth, null, 2), "utf8");

  const modelsFile = readJsonFile<{ providers?: Record<string, unknown> }>(
    paths.modelsPath,
    { providers: {} },
  );
  if (!modelsFile.providers || typeof modelsFile.providers !== "object") {
    modelsFile.providers = {};
  }
  pruneStaleProviderKeys(modelsFile.providers, profile.providerId);
  // Full replace of this provider's model list (edit must drop removed ids).
  modelsFile.providers[profile.providerId] = {
    baseUrl: profile.baseUrl,
    api: profile.api,
    models: profile.models.map((m) =>
      modelEntryForPiModelsJson(
        m,
        profile.api,
        profile.providerId,
        profile.baseUrl,
      ),
    ),
  };
  writeFileSync(paths.modelsPath, JSON.stringify(modelsFile, null, 2), "utf8");

  store.activeId = profile.id;
  saveStore(paths, store);

  if (options?.updatePrefs !== false) {
    patchPrefs({
      provider: profile.providerId,
      model: primary.id,
    });
  }

  return {
    ok: true,
    provider: profile.providerId,
    model: primary.id,
  };
}

interface ImportCandidate {
  name: string;
  providerId: string;
  api: ProviderApiKind;
  baseUrl: string;
  apiKey: string;
  models: ProviderModelEntry[];
  notes?: string;
  preferActive?: boolean;
  source: "pi" | "cc-switch";
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * 计算档案指纹。包含 providerId + api + baseUrl + apiKey，
 * 保证同 key 在不同 providerId / api 维度下能共存（避免 import 时误去重）。
 */
function profileFingerprint(input: {
  providerId?: string;
  api: string;
  baseUrl: string;
  apiKey: string;
}): string {
  const pid = (input.providerId ?? "").trim();
  return `${pid}|${input.api}|${normalizeBaseUrl(input.baseUrl)}|${input.apiKey.trim()}`;
}

/**
 * 将任意字符串规整为合法 providerId slug。
 * 中文 / emoji 等非 ASCII 字符会被替换为 `-`，但若结果全为空或只剩连字符，
 * 直接回退到 fallback，避免产生空字符串或不合法 ID。
 */
function slugifyProviderId(raw: string, fallback: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug && /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/i.test(slug)) return slug;
  return fallback;
}

function uniqueProviderId(desired: string, used: Set<string>): string {
  let base = slugifyProviderId(desired, `provider-${randomUUID().slice(0, 8)}`);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let i = 2; i < 1000; i++) {
    const next = `${base}-${i}`;
    if (!used.has(next)) {
      used.add(next);
      return next;
    }
  }
  const fallback = `${base}-${randomUUID().slice(0, 8)}`;
  used.add(fallback);
  return fallback;
}

function coerceApiKind(value: unknown, fallback: ProviderApiKind): ProviderApiKind {
  if (typeof value === "string" && API_KINDS.includes(value as ProviderApiKind)) {
    return value as ProviderApiKind;
  }
  return fallback;
}

/**
 * 根据 providerId 推断默认 API 类型。
 * 优先级：精确 ID > 已知子串（仅匹配厂商主体，避免 "minimax" 子串误伤其它 ID）。
 */
function inferApiForProviderId(providerId: string): ProviderApiKind {
  const id = providerId.toLowerCase();
  // 精确 ID 优先：列表来源包括内置 builtinDefaults 与预设别名。
  const exact: Record<string, ProviderApiKind> = {
    anthropic: "anthropic-messages",
    "anthropic-compatible": "anthropic-messages",
    openai: "openai-completions",
    "openai-compatible": "openai-completions",
    "openai-responses": "openai-responses",
    google: "google-generative-ai",
    minimax: "anthropic-messages",
    "minimax-cn": "anthropic-messages",
    "minimax-en": "anthropic-messages",
    xiaomi: "anthropic-messages",
    "xiaomi-mimo": "anthropic-messages",
    deepseek: "openai-completions",
    "deepseek-anthropic": "anthropic-messages",
    kimi: "anthropic-messages",
    "kimi-coding": "anthropic-messages",
    zhipu: "anthropic-messages",
    "zhipu-en": "anthropic-messages",
    bailian: "anthropic-messages",
    "bailian-coding": "anthropic-messages",
    stepfun: "anthropic-messages",
    longcat: "anthropic-messages",
    doubao: "anthropic-messages",
    bailing: "anthropic-messages",
    qianfan: "anthropic-messages",
    siliconflow: "openai-completions",
    "siliconflow-en": "openai-completions",
    openrouter: "openai-completions",
    aihubmix: "anthropic-messages",
    dmxapi: "anthropic-messages",
    modelscope: "anthropic-messages",
    novita: "anthropic-messages",
    nvidia: "openai-completions",
    packycode: "anthropic-messages",
  };
  if (exact[id]) return exact[id];
  // 子串判断仅在精确表 miss 时兜底；只命中厂商名，避免 "minimax" / "mimo" 等
  // 子串误命中其它不相关 ID（例如包含 minimax 的自定义网关）。
  if (id.includes("anthropic") || id.includes("claude")) return "anthropic-messages";
  if (id.includes("gemini") || id.includes("google")) return "google-generative-ai";
  if (id.includes("gpt") || id.includes("openai")) return "openai-completions";
  if (id.endsWith("-responses") || id.includes("response")) return "openai-responses";
  return "openai-completions";
}

function knownBuiltinDefaults(providerId: string): {
  api: ProviderApiKind;
  baseUrl: string;
  models: ProviderModelEntry[];
} | null {
  const preset = listProviderPresets().find((p) => p.providerId === providerId);
  if (preset) {
    return { api: preset.api, baseUrl: preset.baseUrl, models: preset.models };
  }
  const builtins: Record<
    string,
    { api: ProviderApiKind; baseUrl: string; models: ProviderModelEntry[] }
  > = {
    anthropic: {
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet" }],
    },
    openai: {
      api: "openai-completions",
      baseUrl: "https://api.openai.com/v1",
      models: [{ id: "gpt-4o", name: "GPT-4o" }],
    },
    google: {
      api: "google-generative-ai",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      models: [{ id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" }],
    },
    minimax: {
      api: "anthropic-messages",
      baseUrl: "https://api.minimax.io/anthropic",
      models: [{ id: "MiniMax-M2.7", name: "MiniMax M2.7" }],
    },
    "minimax-cn": {
      api: "anthropic-messages",
      baseUrl: "https://api.minimaxi.com/anthropic",
      models: [{ id: "MiniMax-M2.7", name: "MiniMax M2.7" }],
    },
    xiaomi: {
      api: "anthropic-messages",
      baseUrl: "https://api.xiaomimimo.com/anthropic",
      models: [{ id: "mimo-v2-flash", name: "MiMo V2 Flash" }],
    },
    // 与预设 providerId 对齐；从早期 Pi auth/models 导入时也能命中。
    "deepseek-anthropic": {
      api: "anthropic-messages",
      baseUrl: "https://api.deepseek.com/anthropic",
      models: [{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }],
    },
  };
  return builtins[providerId] ?? null;
}

function parseModelsField(raw: unknown): ProviderModelEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string" && item.trim()) {
        return enrichModelEntry({ id: item.trim() });
      }
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const id = typeof obj.id === "string" ? obj.id.trim() : "";
        if (!id) return null;
        const name = typeof obj.name === "string" ? obj.name.trim() : "";
        const contextWindow = normalizePositiveInt(
          obj.contextWindow ?? obj.context_window,
        );
        return enrichModelEntry({
          id,
          ...(name ? { name } : {}),
          ...(contextWindow != null ? { contextWindow } : {}),
        });
      }
      return null;
    })
    .filter((m): m is ProviderModelEntry => !!m);
}

function extractApiKeyFromAuthEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  if (obj.type === "api_key" && typeof obj.key === "string" && obj.key.trim()) {
    return obj.key.trim();
  }
  // Some tools store bare key strings / alternate shapes.
  if (typeof obj.key === "string" && obj.key.trim()) return obj.key.trim();
  if (typeof obj.apiKey === "string" && obj.apiKey.trim()) return obj.apiKey.trim();
  return null;
}

function collectPiCandidates(paths: ProviderPaths): ImportCandidate[] {
  const auth = readJsonFile<Record<string, unknown>>(paths.authPath, {});
  const modelsFile = readJsonFile<{
    providers?: Record<string, Record<string, unknown>>;
  }>(paths.modelsPath, { providers: {} });
  const settings = readJsonFile<{
    defaultProvider?: string;
    defaultModel?: string;
  }>(join(paths.agentDir, "settings.json"), {});

  const providers = modelsFile.providers ?? {};
  const ids = new Set([...Object.keys(auth), ...Object.keys(providers)]);
  const out: ImportCandidate[] = [];

  for (const providerId of ids) {
    const apiKey = extractApiKeyFromAuthEntry(auth[providerId]);
    if (!apiKey) continue;

    const cfg = providers[providerId] ?? {};
    const builtin = knownBuiltinDefaults(providerId);
    const api = coerceApiKind(
      cfg.api,
      builtin?.api ?? inferApiForProviderId(providerId),
    );
    const baseUrlRaw =
      (typeof cfg.baseUrl === "string" && cfg.baseUrl.trim()) ||
      builtin?.baseUrl ||
      "";
    if (!baseUrlRaw) continue;
    try {
      // eslint-disable-next-line no-new
      new URL(baseUrlRaw);
    } catch {
      continue;
    }

    let models = parseModelsField(cfg.models);
    if (!models.length && builtin?.models.length) {
      models = builtin.models.slice();
    }
    if (
      !models.length &&
      settings.defaultProvider === providerId &&
      typeof settings.defaultModel === "string" &&
      settings.defaultModel.trim()
    ) {
      models = [{ id: settings.defaultModel.trim() }];
    }
    if (!models.length) {
      models = [{ id: `${providerId}-default` }];
    }

    out.push({
      name: providerId,
      providerId,
      api,
      baseUrl: normalizeBaseUrl(baseUrlRaw),
      apiKey,
      models,
      notes: "从 Pi auth.json / models.json 导入",
      preferActive: settings.defaultProvider === providerId,
      source: "pi",
    });
  }

  return out;
}

function defaultCcSwitchDbPath(): string {
  return join(homedir(), ".cc-switch", "cc-switch.db");
}

function modelsFromCcSwitchEnv(env: Record<string, unknown>): ProviderModelEntry[] {
  const keys = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_REASONING_MODEL",
    "OPENAI_MODEL",
  ];
  const seen = new Set<string>();
  const models: ProviderModelEntry[] = [];
  for (const key of keys) {
    const value = env[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const id = value.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ id });
  }
  return models;
}

function collectCcSwitchCandidates(dbPath: string): ImportCandidate[] {
  if (!existsSync(dbPath)) return [];

  let DatabaseSync: new (path: string, options?: { readonly?: boolean }) => {
    prepare: (sql: string) => {
      all: (...params: unknown[]) => Record<string, unknown>[];
    };
    close: () => void;
  };
  try {
    // Node / Electron 22+ experimental sqlite; optional for environments without it.
    ({ DatabaseSync } = nodeRequire("node:sqlite") as {
      DatabaseSync: typeof DatabaseSync;
    });
  } catch {
    return [];
  }

  const out: ImportCandidate[] = [];
  let db: InstanceType<typeof DatabaseSync> | null = null;
  try {
    db = new DatabaseSync(dbPath, { readonly: true });
    const rows = db
      .prepare(
        `SELECT id, app_type, name, settings_config, is_current, icon
         FROM providers`,
      )
      .all();

    // Prefer Claude over Claude Desktop for the same fingerprint.
    const appPriority: Record<string, number> = {
      claude: 3,
      openclaw: 3,
      codex: 2,
      gemini: 2,
      "claude-desktop": 1,
    };
    const allowedApps = new Set([
      "claude",
      "claude-desktop",
      "openclaw",
      "codex",
      "gemini",
    ]);
    const bestByFp = new Map<
      string,
      { candidate: ImportCandidate; priority: number }
    >();

    for (const row of rows) {
      const appType = String(row.app_type ?? "");
      if (!allowedApps.has(appType)) continue;
      const name = String(row.name ?? "").trim() || "cc-switch";
      const icon = typeof row.icon === "string" ? row.icon : "";
      let settings: Record<string, unknown> = {};
      try {
        settings =
          typeof row.settings_config === "string" && row.settings_config
            ? (JSON.parse(row.settings_config) as Record<string, unknown>)
            : {};
      } catch {
        continue;
      }

      let api: ProviderApiKind | null = null;
      let baseUrl = "";
      let apiKey = "";
      let models: ProviderModelEntry[] = [];

      if (appType === "claude" || appType === "claude-desktop") {
        const env =
          settings.env && typeof settings.env === "object"
            ? (settings.env as Record<string, unknown>)
            : {};
        baseUrl =
          (typeof env.ANTHROPIC_BASE_URL === "string" &&
            env.ANTHROPIC_BASE_URL.trim()) ||
          "";
        apiKey =
          (typeof env.ANTHROPIC_AUTH_TOKEN === "string" &&
            env.ANTHROPIC_AUTH_TOKEN.trim()) ||
          (typeof env.ANTHROPIC_API_KEY === "string" &&
            env.ANTHROPIC_API_KEY.trim()) ||
          "";
        api = "anthropic-messages";
        models = modelsFromCcSwitchEnv(env);
      } else if (appType === "openclaw") {
        baseUrl =
          typeof settings.baseUrl === "string" ? settings.baseUrl.trim() : "";
        apiKey =
          typeof settings.apiKey === "string" ? settings.apiKey.trim() : "";
        api = coerceApiKind(settings.api, "openai-completions");
        models = parseModelsField(settings.models);
      } else if (appType === "codex") {
        // Codex official auth blobs are not Pi-compatible; skip empty / oauth-only.
        continue;
      } else if (appType === "gemini") {
        const env =
          settings.env && typeof settings.env === "object"
            ? (settings.env as Record<string, unknown>)
            : {};
        apiKey =
          (typeof env.GEMINI_API_KEY === "string" && env.GEMINI_API_KEY.trim()) ||
          (typeof env.GOOGLE_API_KEY === "string" && env.GOOGLE_API_KEY.trim()) ||
          "";
        baseUrl =
          (typeof env.GOOGLE_GEMINI_BASE_URL === "string" &&
            env.GOOGLE_GEMINI_BASE_URL.trim()) ||
          "https://generativelanguage.googleapis.com/v1beta";
        api = "google-generative-ai";
        const model =
          typeof env.GEMINI_MODEL === "string" ? env.GEMINI_MODEL.trim() : "";
        if (model) models = [{ id: model }];
      }

      if (!api || !baseUrl || !apiKey) continue;
      try {
        // eslint-disable-next-line no-new
        new URL(baseUrl);
      } catch {
        continue;
      }
      if (!models.length) {
        models = [{ id: `${slugifyProviderId(icon || name, "model")}-default` }];
      }

      const desiredId = slugifyProviderId(
        icon || name,
        `cc-${String(row.id ?? randomUUID()).slice(0, 8)}`,
      );
      const candidate: ImportCandidate = {
        name,
        providerId: desiredId,
        api,
        baseUrl: normalizeBaseUrl(baseUrl),
        apiKey,
        models,
        notes: `从 cc-switch（${appType}）导入`,
        preferActive: Boolean(row.is_current) && appType === "claude",
        source: "cc-switch",
      };
      const fp = profileFingerprint({
        providerId: candidate.providerId,
        api: candidate.api,
        baseUrl: candidate.baseUrl,
        apiKey: candidate.apiKey,
      });
      const priority = appPriority[appType] ?? 0;
      const prev = bestByFp.get(fp);
      if (!prev || priority > prev.priority) {
        bestByFp.set(fp, { candidate, priority });
      }
    }

    for (const { candidate } of bestByFp.values()) {
      out.push(candidate);
    }
  } catch {
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }

  return out;
}

/**
 * Import provider profiles from existing Pi auth/models and cc-switch DB.
 * Dedupes by api+baseUrl+apiKey fingerprint against already saved profiles.
 */
export function importExistingProviderProfiles(
  paths: ProviderPaths = defaultProviderPaths(),
  options?: { ccSwitchDbPath?: string },
): ProviderImportResult {
  const store = loadStore(paths);
  const usedIds = new Set(store.profiles.map((p) => p.providerId));
  const existingFp = new Set(
    store.profiles.map((p) =>
      profileFingerprint({
        providerId: p.providerId,
        api: p.api,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
      }),
    ),
  );

  const pi = collectPiCandidates(paths);
  const cc = collectCcSwitchCandidates(
    options?.ccSwitchDbPath ?? defaultCcSwitchDbPath(),
  );
  const sources = new Set<string>();
  if (pi.length) sources.add("pi");
  if (cc.length) sources.add("cc-switch");

  // Prefer Pi first so built-in providerIds stay stable; cc-switch fills the rest.
  const candidates = [...pi, ...cc];
  let imported = 0;
  let skipped = 0;
  let activeCandidateId: string | null = null;
  const now = new Date().toISOString();

  for (const candidate of candidates) {
    const fp = profileFingerprint({
      providerId: candidate.providerId,
      api: candidate.api,
      baseUrl: candidate.baseUrl,
      apiKey: candidate.apiKey,
    });
    if (existingFp.has(fp)) {
      skipped += 1;
      continue;
    }
    const providerId = uniqueProviderId(candidate.providerId, usedIds);
    const profile: ProviderProfile = {
      id: randomUUID(),
      name: candidate.name,
      providerId,
      api: candidate.api,
      baseUrl: candidate.baseUrl,
      apiKey: candidate.apiKey,
      models: candidate.models,
      notes: candidate.notes,
      updatedAt: now,
    };
    store.profiles.push(profile);
    existingFp.add(fp);
    imported += 1;
    if (candidate.preferActive) {
      activeCandidateId = profile.id;
    }
  }

  if (imported > 0) {
    if (!store.activeId && activeCandidateId) {
      store.activeId = activeCandidateId;
    }
    saveStore(paths, store);
  } else if (!existsSync(paths.storePath)) {
    // Persist empty store so listProviderProfiles does not re-scan forever.
    saveStore(paths, store);
  }

  return {
    ok: true,
    imported,
    skipped,
    sources: [...sources],
  };
}
