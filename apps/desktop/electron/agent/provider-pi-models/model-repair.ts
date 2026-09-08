/**
 * provider-pi-models / model-repair —— 启动期隐式触发的 Pi models.json 修复
 * (issue #68 主题 J C-103).
 *
 * 唯一职责: 启动期一次性扫 ~/.pi/agent/models.json, 给 DeepSeek / MiniMax
 * 历史 entry 补上 `reasoning` / `compat` / `thinkingLevelMap`, 防止 Pi
 * SDK 的 builtin compat 假设与 X-agent 注入冲突时把 thinking 全部 clamp
 * 到 off.
 *
 * 与 syncProfileToPi 的区别:
 * - syncProfileToPi 走 withModelsLock 锁内 read-modify-write (concurrent-safe)
 * - repair 启动期单跑, 走 withStoreLock 直接锁 (同锁不冲突) — 复用
 *   lib/store-mutex 链避免新锁.
 *
 * 拆出来的好处: repair 不需要 import sync 流程, 也不需要 import dedup 模块.
 */
import { existsSync, readFileSync } from "node:fs";
import type { ProviderApiKind } from "../../../shared/ipc";
import { withStoreLock } from "../lib/store-mutex";
import { writeJsonAtomic } from "../lib/atomic-write";
import {
  defaultProviderPaths,
  type ProviderPaths,
} from "../provider-persist";
import {
  deepseekProxyModelExtras,
  isPiAutoDetectedDeepSeekEndpoint,
  looksLikeDeepSeekModelId,
  looksLikeMiniMaxModelId,
  minimaxModelExtras,
} from "./model-shape";

const API_KINDS: ProviderApiKind[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

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
