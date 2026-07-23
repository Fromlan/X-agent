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
import { getAgentDirPath, patchPrefs } from "./prefs";

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

function profileFingerprint(input: {
  api: string;
  baseUrl: string;
  apiKey: string;
}): string {
  return `${input.api}|${normalizeBaseUrl(input.baseUrl)}|${input.apiKey.trim()}`;
}

function slugifyProviderId(raw: string, fallback: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (/^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/i.test(slug)) return slug;
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

function inferApiForProviderId(providerId: string): ProviderApiKind {
  const id = providerId.toLowerCase();
  if (
    id.includes("anthropic") ||
    id.includes("claude") ||
    id.includes("minimax") ||
    id.includes("xiaomi") ||
    id.includes("mimo")
  ) {
    return "anthropic-messages";
  }
  if (id.includes("google") || id.includes("gemini")) {
    return "google-generative-ai";
  }
  if (id.includes("openai") && id.includes("response")) {
    return "openai-responses";
  }
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
  };
  return builtins[providerId] ?? null;
}

function parseModelsField(raw: unknown): ProviderModelEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string" && item.trim()) {
        return { id: item.trim() };
      }
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const id = typeof obj.id === "string" ? obj.id.trim() : "";
        if (!id) return null;
        const name = typeof obj.name === "string" ? obj.name.trim() : "";
        return name ? { id, name } : { id };
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
      const fp = profileFingerprint(candidate);
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
    const fp = profileFingerprint(candidate);
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
