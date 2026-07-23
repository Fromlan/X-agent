import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ProviderActivateResult,
  ProviderApiKind,
  ProviderPreset,
  ProviderProfile,
  ProviderProfileSummary,
  ProviderUpsertInput,
} from "../../shared/ipc";
import { getAgentDirPath, patchPrefs } from "./prefs";

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
  return [
    {
      id: "deepseek",
      name: "DeepSeek",
      providerId: "deepseek",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com",
      models: [
        { id: "deepseek-chat", name: "DeepSeek Chat" },
        { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
        { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
      ],
      notes: "官方 DeepSeek OpenAI-compatible 接口",
    },
    {
      id: "openai-compatible",
      name: "OpenAI Compatible",
      providerId: "openai-compatible",
      api: "openai-completions",
      baseUrl: "https://api.openai.com/v1",
      models: [{ id: "gpt-4o", name: "GPT-4o" }],
      notes: "通用 OpenAI Chat Completions 兼容网关",
    },
    {
      id: "anthropic-compatible",
      name: "Anthropic Compatible",
      providerId: "anthropic",
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet" }],
      notes: "Anthropic Messages / 兼容中转",
    },
    {
      id: "siliconflow",
      name: "SiliconFlow",
      providerId: "siliconflow",
      api: "openai-completions",
      baseUrl: "https://api.siliconflow.cn/v1",
      models: [{ id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" }],
      notes: "硅基流动 OpenAI 兼容",
    },
    {
      id: "custom",
      name: "自定义空白",
      providerId: "custom",
      api: "openai-completions",
      baseUrl: "https://example.com/v1",
      models: [{ id: "my-model" }],
      notes: "自行填写 endpoint 与模型",
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
  return {
    version: 1,
    activeId: raw.activeId ?? null,
    profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
  };
}

function saveStore(paths: ProviderPaths, store: ProviderStoreFile): void {
  ensureParent(paths.storePath);
  writeFileSync(paths.storePath, JSON.stringify(store, null, 2), "utf8");
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
): { ok: boolean; profile?: ProviderProfile; error?: string } {
  const err = validateUpsert(input);
  if (err) return { ok: false, error: err };

  const store = loadStore(paths);
  const now = new Date().toISOString();
  const models = input.models
    .map((m) => ({
      id: m.id.trim(),
      ...(m.name?.trim() ? { name: m.name.trim() } : {}),
    }))
    .filter((m) => m.id);

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
  modelsFile.providers[profile.providerId] = {
    baseUrl: profile.baseUrl,
    api: profile.api,
    models: profile.models.map((m) => ({
      id: m.id,
      ...(m.name ? { name: m.name } : {}),
    })),
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
