import { existsSync, readFileSync } from "node:fs";
import type { ProviderApiKind, ProviderModelEntry } from "../../shared/ipc";
import { enrichModelEntry } from "../../shared/model-context";
import { withStoreLock } from "./lib/store-mutex";
import { writeJsonAtomic } from "./lib/atomic-write";
import {
  defaultProviderPaths,
  type ProviderPaths,
} from "./provider-persist";

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

/**
 * Patch existing ~/.pi/agent/models.json DeepSeek entries that lack `reasoning`.
 * Custom ids (e.g. deepseek-v4-pro[1M]) written before this fix clamp thinking to off.
 * Returns true when the file was rewritten.
 * B4: 写入走与 provider-pi-sync 相同的 models.json 锁 + 原子写（tmp+rename），
 * 避免与并发激活档案的加锁写互踩（撕裂 / 丢更新）或崩溃截断文件。
 */
export async function repairDeepSeekModelsJson(
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<boolean> {
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
  await withStoreLock(paths.modelsPath, () =>
    writeJsonAtomic(paths.modelsPath, modelsFile),
  );
  return true;
}

/**
 * Patch existing ~/.pi/agent/models.json MiniMax entries that lack `reasoning`
 * / `compat.forceAdaptiveThinking` / `thinkingLevelMap`. Without these, Pi's
 * anthropic-messages adapter clamps every thinking level to off (issue: thinking
 * strength selector is dead for MiniMax). Idempotent: returns true only when at
 * least one entry was actually rewritten.
 *
 * B4: shares the models.json lock + atomic write with provider-pi-sync so
 * concurrent activate/edit calls cannot tear or truncate the file.
 */
export async function repairMiniMaxModelsJson(
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<boolean> {
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
  for (const [, rawProvider] of Object.entries(providers)) {
    if (!rawProvider || typeof rawProvider !== "object") continue;
    const provider = rawProvider as {
      models?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(provider.models)) continue;

    provider.models = provider.models.map((model) => {
      const id = typeof model.id === "string" ? model.id : "";
      if (!id || !looksLikeMiniMaxModelId(id)) return model;
      const extras = minimaxModelExtras(id);
      if (!extras) return model;
      const next = { ...model };
      if (next.reasoning !== true) {
        next.reasoning = true;
        changed = true;
      }
      // compat: only patch if missing or wrong type; do not overwrite a
      // user-supplied compat (none today — MiniMax always uses our shape).
      if (
        next.compat == null ||
        typeof next.compat !== "object" ||
        (next.compat as { forceAdaptiveThinking?: unknown })
          .forceAdaptiveThinking !== true
      ) {
        next.compat = extras.compat;
        changed = true;
      }
      // thinkingLevelMap: value-level compare against the canonical shape.
      // A previous release wrote a 6-key map for M3 (off/minimal/low/medium/
      // high/max all mapped to themselves); the new M3 shape is the binary
      // off/max (minimal/low/medium/high all `null`). A key-presence check
      // alone lets the old 6-key M3 entry slip through, leaving the UI
      // dropdown showing 5 redundant "thinking on" levels that all map to
      // the same `adaptive` request. Compare values, not just keys.
      const canonical = extras.thinkingLevelMap;
      const existing = next.thinkingLevelMap;
      const canonicalKeys = Object.keys(canonical);
      const existingKeys =
        existing != null && typeof existing === "object"
          ? Object.keys(existing)
          : [];
      const mapMatches =
        existing != null &&
        typeof existing === "object" &&
        canonicalKeys.every((k) => (existing as Record<string, unknown>)[k] === canonical[k]) &&
        existingKeys.every((k) => k in canonical);
      if (!mapMatches) {
        next.thinkingLevelMap = canonical;
        changed = true;
      }
      return next;
    });
  }

  if (!changed) return false;
  await withStoreLock(paths.modelsPath, () =>
    writeJsonAtomic(paths.modelsPath, modelsFile),
  );
  return true;
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
