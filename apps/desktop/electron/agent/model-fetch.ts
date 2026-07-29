/**
 * Fetch OpenAI-compatible model lists (cc-switch style candidate URL probing).
 */

import {
  parseContextWindowFromApiModel,
  resolveModelContextWindow,
} from "../../shared/model-context";

export interface FetchedModel {
  id: string;
  ownedBy?: string;
  contextWindow?: number;
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

const FETCH_TIMEOUT_MS = 15_000;
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
    candidates.push(`${trimmed}/v1/models`);
  }

  const stripped = stripCompatSuffix(trimmed);
  if (stripped) {
    const root = stripped.replace(/\/+$/, "");
    if (root.includes("://")) {
      candidates.push(`${root}/v1/models`);
      candidates.push(`${root}/models`);
    }
  }

  const unique: string[] = [];
  for (const url of candidates) {
    if (!unique.includes(url)) unique.push(url);
  }
  return unique;
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
    models.push({
      id: id.trim(),
      ...(typeof ownedBy === "string" ? { ownedBy } : {}),
      ...(contextWindow != null ? { contextWindow } : {}),
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.apiKey.trim()}`,
          Accept: "application/json",
          "User-Agent": "X-agent/0.1",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

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
      clearTimeout(timer);
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
