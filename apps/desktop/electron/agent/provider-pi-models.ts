import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ProviderApiKind, ProviderModelEntry } from "../../shared/ipc";
import { enrichModelEntry } from "../../shared/model-context";
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
