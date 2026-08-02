import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ProviderApiKind,
  ProviderImportResult,
  ProviderModelEntry,
  ProviderProfile,
} from "../../shared/ipc";
import {
  enrichModelEntry,
  normalizePositiveInt,
} from "../../shared/model-context";
import { listProviderPresets } from "./provider-presets";
import {
  API_KINDS,
  defaultProviderPaths,
  loadStore,
  readJsonFile,
  saveStore,
  type ProviderPaths,
} from "./provider-persist";

const nodeRequire = createRequire(import.meta.url);

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
      enabled: true,
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
