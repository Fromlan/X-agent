/**
 * Fetch OpenAI-compatible model lists (cc-switch style candidate URL probing).
 */

import {
  parseContextWindowFromApiModel,
  resolveModelContextWindow,
} from "../../shared/model-context";
import { validateOutboundHttpUrl } from "./external-url";

export interface FetchedModel {
  id: string;
  ownedBy?: string;
  contextWindow?: number;
  /** DeepSeek `max_output_tokens` → 透传到 ProviderModelEntry.maxOutputTokens → Pi maxTokens */
  maxOutputTokens?: number;
  /** DeepSeek `input_modalities: ["text","image"]` 等 */
  input?: ("text" | "image")[];
  /** DeepSeek `output_modalities`,保留供扩展。 */
  output?: ("text" | "image")[];
  /** DeepSeek `effort.supported_levels` / `default_level` */
  effort?: { supportedLevels?: string[]; defaultLevel?: string };
  /** DeepSeek `api_capabilities` 透传。 */
  apiCapabilities?: Record<string, unknown>;
  /**
   * 已翻译为 Pi `thinkingLevelMap` 形态。DeepSeek thinking 只有开/关二态,
   * 所以全部非 off UI 档位都路由到 effort.supportedLevels[0] 作为「开」的占位值;
   * 如果供应商支持多档 effort,后续可以按 user-level -> api-level 1:1 翻译。
   */
  thinkingLevelMap?: Record<string, string | null>;
}

const KNOWN_COMPAT_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude",
] as const;

/**
 * 单个候选端点的 fetch 超时。从 15s 收到 8s：4 个候选依次尝试时最长
 * 总耗时上限 ~32s；早先 15s * 4 = 60s 体感过慢，多数 baseUrl 命中
 * 首个候选即可。`AbortSignal.timeout` 单次 signal 让 fetch 在到点
 * 时立刻 reject，不用 setTimeout 手动 cancel。
 */
const FETCH_TIMEOUT_MS = 8_000;
const ERROR_BODY_MAX = 512;

function endsWithVersionSegment(url: string): boolean {
  const last = url.split("/").pop() ?? "";
  if (!last.startsWith("v") || last.length < 2) return false;
  return /^v\d+$/.test(last);
}

function stripCompatSuffix(baseUrl: string): string | null {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) {
      return baseUrl.slice(0, baseUrl.length - suffix.length);
    }
  }
  return null;
}

function truncateBody(body: string): string {
  if (body.length <= ERROR_BODY_MAX) return body;
  return `${body.slice(0, ERROR_BODY_MAX)}…`;
}

/** Build candidate /models endpoints (exported for unit tests). */
export function buildModelsUrlCandidates(
  baseUrl: string,
  isFullUrl = false,
  modelsUrlOverride?: string | null,
): string[] {
  if (modelsUrlOverride?.trim()) {
    return [modelsUrlOverride.trim()];
  }

  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Base URL 为空");
  }

  const candidates: string[] = [];

  if (isFullUrl) {
    const v1Idx = trimmed.indexOf("/v1/");
    if (v1Idx >= 0) {
      candidates.push(`${trimmed.slice(0, v1Idx)}/v1/models`);
    } else {
      const lastSlash = trimmed.lastIndexOf("/");
      if (lastSlash > trimmed.indexOf("://") + 2) {
        candidates.push(`${trimmed.slice(0, lastSlash)}/v1/models`);
      }
    }
    if (candidates.length === 0) {
      throw new Error("无法从完整 URL 推导模型端点");
    }
    return candidates;
  }

  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`);
    if (!trimmed.endsWith("/v1")) {
      candidates.push(`${trimmed}/v1/models`);
    }
  } else {
    // /models 优先 (DeepSeek 官方 api.deepseek.com/models 返回扩展 schema
    // 含 effort/input_modalities/api_capabilities); /v1/models 作为 OpenAI
    // 标准兼容兜底。baseUrl 是裸 host 或非版本路径都按这个顺序。
    candidates.push(`${trimmed}/models`);
    candidates.push(`${trimmed}/v1/models`);
  }

  const stripped = stripCompatSuffix(trimmed);
  if (stripped) {
    const root = stripped.replace(/\/+$/, "");
    if (root.includes("://")) {
      candidates.push(`${root}/models`);
      candidates.push(`${root}/v1/models`);
    }
  }

  const unique: string[] = [];
  for (const url of candidates) {
    if (!unique.includes(url)) unique.push(url);
  }
  return unique;
}

/**
 * 翻译 `effort.supported_levels` 为 Pi `thinkingLevelMap` 形态。
 *
 * Pi SDK 期望 `{userLevel: apiLevel}` (例: `{medium: "medium", high: "high"}`)。
 * 供应商 (如 DeepSeek) 给的 `effort.supported_levels` 是该供应商真实接受的
 * effort 字符串列表。对仅二态 (开/关) 的供应商, 全部非 off UI 档位都映射到
 * 首个 supported level 作为「开」的占位值; 多档供应商 1:1 对齐到 supported level。
 *
 * user-level -> api-level 单调近似:
 *   off       -> off
 *   minimal   -> supported[0] || null
 *   low       -> 包含 "low" 用 "low",否则 supported[0]
 *   medium    -> 包含 "medium" 用 "medium",否则居中档
 *   high      -> 包含 "high" 用 "high",否则 supported 末档
 *   max       -> supported 末档
 */
export function effortToThinkingLevelMap(
  supportedLevels: readonly string[],
): Record<string, string | null> {
  const levels = supportedLevels.filter((l) => typeof l === "string");
  if (levels.length === 0) {
    return {
      off: "off",
      minimal: null,
      low: null,
      medium: null,
      high: null,
      max: null,
    };
  }
  const find = (name: string): string | null =>
    levels.includes(name) ? name : null;
  const first = levels[0];
  const last = levels[levels.length - 1];
  return {
    off: "off",
    minimal: find("low") ?? first,
    low: find("low") ?? first,
    medium: find("medium") ?? find("low") ?? first,
    high: find("high") ?? last,
    max: last,
  };
}

/** Read `max_output_tokens` from a /v1/models data[] entry (DeepSeek 等). */
function parseMaxOutputTokens(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  for (const key of ["max_output_tokens", "max_tokens", "maxOutputTokens"]) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      return Math.round(v);
    }
  }
  return undefined;
}

/** Read `input_modalities` / `output_modalities` from a /v1/models data[] entry. */
function parseModalities(
  raw: unknown,
  key: string,
): ("text" | "image")[] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const arr = obj[key];
  if (!Array.isArray(arr)) return undefined;
  const out: ("text" | "image")[] = [];
  for (const v of arr) {
    if (v === "text" || v === "image") out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

/** Read `effort` block from a /v1/models data[] entry (DeepSeek 等). */
function parseEffort(raw: unknown):
  | { supportedLevels?: string[]; defaultLevel?: string }
  | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const eff = obj.effort;
  if (!eff || typeof eff !== "object") return undefined;
  const e = eff as Record<string, unknown>;
  const supported = e.supported_levels;
  const def = e.default_level;
  return {
    ...(Array.isArray(supported)
      ? { supportedLevels: supported.filter((x) => typeof x === "string") }
      : {}),
    ...(typeof def === "string" ? { defaultLevel: def } : {}),
  };
}

/** Exported for unit tests. */
export function parseModelsJson(json: unknown): FetchedModel[] {
  if (!json || typeof json !== "object") return [];
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const models: FetchedModel[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim()) continue;
    const ownedBy = (entry as { owned_by?: unknown }).owned_by;
    const fromApi = parseContextWindowFromApiModel(entry);
    const contextWindow = resolveModelContextWindow({
      id: id.trim(),
      fromApi,
    });
    const maxOutputTokens = parseMaxOutputTokens(entry);
    const input = parseModalities(entry, "input_modalities");
    const output = parseModalities(entry, "output_modalities");
    const effort = parseEffort(entry);
    const apiCapabilities =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>).api_capabilities
        : undefined;
    const thinkingLevelMap =
      effort?.supportedLevels && effort.supportedLevels.length > 0
        ? effortToThinkingLevelMap(effort.supportedLevels)
        : undefined;
    models.push({
      id: id.trim(),
      ...(typeof ownedBy === "string" ? { ownedBy } : {}),
      ...(contextWindow != null ? { contextWindow } : {}),
      ...(maxOutputTokens != null ? { maxOutputTokens } : {}),
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
      ...(effort ? { effort } : {}),
      ...(apiCapabilities && typeof apiCapabilities === "object"
        ? { apiCapabilities: apiCapabilities as Record<string, unknown> }
        : {}),
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    });
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

export async function fetchProviderModels(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: boolean; models?: FetchedModel[]; error?: string; tried?: string[] }> {
  if (!input.apiKey.trim()) {
    return { ok: false, error: "请先填写 API Key" };
  }
  if (!input.baseUrl.trim()) {
    return { ok: false, error: "请先填写 Base URL" };
  }

  // SSRF gate: only public http(s) endpoints are reachable from the main
  // process (the request carries the user's API Key as Bearer token).
  const checked = await validateOutboundHttpUrl(input.baseUrl);
  if (!checked.ok) {
    return {
      ok: false,
      error: `Base URL 不被允许：${checked.error}`,
    };
  }

  let candidates: string[];
  try {
    candidates = buildModelsUrlCandidates(input.baseUrl);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let lastErr = "无候选端点";
  for (const url of candidates) {
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.apiKey.trim()}`,
          Accept: "application/json",
          "User-Agent": "X-agent/0.1",
        },
        signal,
      });

      if (response.ok) {
        const json = (await response.json()) as unknown;
        const models = parseModelsJson(json);
        return { ok: true, models, tried: candidates };
      }

      const body = truncateBody(await response.text().catch(() => ""));
      if (response.status === 404 || response.status === 405) {
        lastErr = `HTTP ${response.status}: ${body}`;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          error: `认证失败（HTTP ${response.status}），请检查 API Key`,
          tried: candidates,
        };
      }
      return {
        ok: false,
        error: `HTTP ${response.status}: ${body}`,
        tried: candidates,
      };
    } catch (err) {
      // AbortSignal.timeout 触发时 err.name === "AbortError"，无需手动 clearTimeout。
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, error: "请求超时", tried: candidates };
      }
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: false,
    error: `所有候选端点均失败（供应商可能未提供 /models）：${lastErr}`,
    tried: candidates,
  };
}
