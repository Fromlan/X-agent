import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ProviderApiKind,
  ProviderModelEntry,
  ProviderProfile,
  ProviderProfileSummary,
  ProviderUpsertInput,
} from "../../shared/ipc";
import {
  enrichModelEntry,
  normalizePositiveInt,
} from "../../shared/model-context";
import { getAgentDirPath } from "./prefs";
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

export const API_KINDS: ProviderApiKind[] = [
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

function emptyStore(): ProviderStoreFile {
  return { version: 1, activeId: null, profiles: [] };
}

export function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function ensureParent(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function normalizeEnabled(value: unknown): boolean {
  return value !== false;
}

function normalizeProfile(
  p: Partial<ProviderProfile> & { apiKey?: string },
): ProviderProfile {
  return {
    id: typeof p.id === "string" ? p.id : randomUUID(),
    name: typeof p.name === "string" ? p.name : "",
    providerId: typeof p.providerId === "string" ? p.providerId : "",
    api: (p.api as ProviderApiKind) ?? "openai-completions",
    baseUrl: typeof p.baseUrl === "string" ? p.baseUrl : "",
    apiKey: decryptSecret(typeof p.apiKey === "string" ? p.apiKey : ""),
    models: Array.isArray(p.models) ? p.models : [],
    notes: typeof p.notes === "string" ? p.notes : undefined,
    updatedAt:
      typeof p.updatedAt === "string"
        ? p.updatedAt
        : new Date().toISOString(),
    enabled: normalizeEnabled(p.enabled),
  };
}

export function loadStore(paths: ProviderPaths): ProviderStoreFile {
  ensureParent(paths.storePath);
  const raw = readJsonFile<Partial<ProviderStoreFile>>(paths.storePath, emptyStore());
  const profiles = (Array.isArray(raw.profiles) ? raw.profiles : []).map((p) =>
    normalizeProfile(p as Partial<ProviderProfile>),
  );
  return {
    version: 1,
    activeId: raw.activeId ?? null,
    profiles,
  };
}

export function saveStore(paths: ProviderPaths, store: ProviderStoreFile): void {
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

function toSummary(profile: ProviderProfile): ProviderProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId,
    api: profile.api,
    baseUrl: profile.baseUrl,
    modelCount: profile.models.length,
    active: profile.enabled,
    enabled: profile.enabled,
    updatedAt: profile.updatedAt,
    apiKeyHint: maskApiKey(profile.apiKey),
  };
}

function applyPiSyncForProfile(
  profile: ProviderProfile,
  paths: ProviderPaths,
  previousProviderId: string | null,
): { ok: boolean; error?: string; syncedToPi: boolean } {
  const {
    syncProfileToPi,
    shouldSeedPrefsOnSync,
    pruneProviderIdFromPi,
  } = nodeRequire("./provider-pi-sync") as typeof import("./provider-pi-sync");

  if (
    previousProviderId &&
    previousProviderId !== profile.providerId
  ) {
    pruneProviderIdFromPi(previousProviderId, paths);
  }

  if (!profile.enabled) {
    pruneProviderIdFromPi(profile.providerId, paths);
    return { ok: true, syncedToPi: false };
  }

  const usingLiveAgentDir =
    paths.storePath === defaultProviderPaths().storePath;
  const synced = syncProfileToPi(profile.id, paths, {
    updatePrefs: usingLiveAgentDir && shouldSeedPrefsOnSync(),
    setActiveId: true,
  });
  if (!synced.ok) {
    return {
      ok: false,
      error: synced.error ?? "同步到模型列表失败",
      syncedToPi: false,
    };
  }
  return { ok: true, syncedToPi: true };
}

/**
 * Whether a runtime provider id should appear in the TopBar model list.
 * Catalog-managed providers (case-insensitive match) only show when enabled;
 * providers not in the catalog pass through (e.g. Pi OAuth builtins).
 */
export function isProviderEnabledInCatalog(
  providerId: string,
  paths: ProviderPaths = defaultProviderPaths(),
): boolean {
  const key = providerId.trim().toLowerCase();
  if (!key) return false;
  const store = loadStore(paths);
  const managed = store.profiles.filter(
    (p) => p.providerId.toLowerCase() === key,
  );
  if (managed.length === 0) return true;
  return managed.some((p) => p.enabled);
}

/** Drop models whose provider is a disabled catalog profile. */
export function filterModelsByCatalogEnabled<
  T extends { provider: string },
>(models: readonly T[], paths: ProviderPaths = defaultProviderPaths()): T[] {
  const store = loadStore(paths);
  if (store.profiles.length === 0) return [...models];

  const enabledByProvider = new Map<string, boolean>();
  for (const p of store.profiles) {
    const key = p.providerId.toLowerCase();
    enabledByProvider.set(
      key,
      (enabledByProvider.get(key) ?? false) || p.enabled,
    );
  }

  return models.filter((m) => {
    const key = m.provider.toLowerCase();
    if (!enabledByProvider.has(key)) return true;
    return enabledByProvider.get(key) === true;
  });
}

export function listProviderProfiles(
  paths: ProviderPaths = defaultProviderPaths(),
): ProviderProfileSummary[] {
  // First launch: seed profiles from Pi auth/models and cc-switch if present.
  if (!existsSync(paths.storePath)) {
    const { importExistingProviderProfiles } = nodeRequire(
      "./provider-import",
    ) as typeof import("./provider-import");
    importExistingProviderProfiles(paths);
  }
  const store = loadStore(paths);
  return store.profiles
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((p) => toSummary(p));
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
  /** True when the profile was written into Pi auth/models. */
  syncedToPi?: boolean;
  /** @deprecated Same as syncedToPi (compat for older UI). */
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

  let profile: ProviderProfile;
  let previousProviderId: string | null = null;

  if (input.id) {
    const idx = store.profiles.findIndex((p) => p.id === input.id);
    if (idx < 0) return { ok: false, error: "档案不存在" };
    const prev = store.profiles[idx]!;
    previousProviderId = prev.providerId;
    profile = {
      ...prev,
      name: input.name.trim(),
      providerId: input.providerId.trim(),
      api: input.api,
      baseUrl: input.baseUrl.trim().replace(/\/$/, ""),
      apiKey: input.apiKey.trim(),
      models,
      notes: input.notes?.trim() || undefined,
      updatedAt: now,
      enabled:
        input.enabled !== undefined
          ? input.enabled !== false
          : prev.enabled,
    };
    store.profiles[idx] = profile;
  } else {
    profile = {
      id: randomUUID(),
      name: input.name.trim(),
      providerId: input.providerId.trim(),
      api: input.api,
      baseUrl: input.baseUrl.trim().replace(/\/$/, ""),
      apiKey: input.apiKey.trim(),
      models,
      notes: input.notes?.trim() || undefined,
      updatedAt: now,
      enabled: input.enabled !== false,
    };
    store.profiles.push(profile);
  }

  saveStore(paths, store);

  const sync = applyPiSyncForProfile(profile, paths, previousProviderId);
  if (!sync.ok) {
    return { ok: false, error: sync.error };
  }

  return {
    ok: true,
    profile,
    syncedToPi: sync.syncedToPi,
    syncedActive: sync.syncedToPi,
  };
}

export function setProviderProfileEnabled(
  id: string,
  enabled: boolean,
  paths: ProviderPaths = defaultProviderPaths(),
): { ok: boolean; error?: string; syncedToPi?: boolean } {
  const store = loadStore(paths);
  const idx = store.profiles.findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: "档案不存在" };
  const profile = {
    ...store.profiles[idx]!,
    enabled: enabled !== false,
    updatedAt: new Date().toISOString(),
  };
  store.profiles[idx] = profile;
  saveStore(paths, store);

  const sync = applyPiSyncForProfile(profile, paths, null);
  if (!sync.ok) {
    return { ok: false, error: sync.error };
  }
  return { ok: true, syncedToPi: sync.syncedToPi };
}

export function deleteProviderProfile(
  id: string,
  paths: ProviderPaths = defaultProviderPaths(),
): { ok: boolean; error?: string; prunedProviderId?: string } {
  const store = loadStore(paths);
  const idx = store.profiles.findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: "档案不存在" };
  const removed = store.profiles[idx]!;
  store.profiles.splice(idx, 1);
  if (store.activeId === id) {
    store.activeId = null;
  }
  saveStore(paths, store);

  const { pruneProviderIdFromPi } = nodeRequire(
    "./provider-pi-sync",
  ) as typeof import("./provider-pi-sync");
  pruneProviderIdFromPi(removed.providerId, paths);

  return { ok: true, prunedProviderId: removed.providerId };
}
