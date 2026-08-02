import { writeFile } from "node:fs/promises";
import type { ProviderActivateResult } from "../../shared/ipc";
import { getCachedPrefs, patchPrefs } from "./prefs";
import {
  modelEntryForPiModelsJson,
  pruneStaleProviderKeys,
} from "./provider-pi-models";
import {
  defaultProviderPaths,
  ensureParent,
  loadStore,
  readJsonFile,
  saveStore,
  type ProviderPaths,
} from "./provider-persist";
import { writeJsonAtomic as atomicWriteJson } from "./lib/atomic-write";

export type SyncProfileToPiOptions = {
  /**
   * When true, set prefs.provider/model to this profile's primary model.
   * Default false — TopBar selection stays; save only publishes the catalog.
   */
  updatePrefs?: boolean;
  /**
   * When true, set store.activeId to this profile (recently saved / selected).
   * Default true.
   */
  setActiveId?: boolean;
};

/**
 * Write a catalog profile into Pi auth.json + models.json.
 * Does not reload ModelRuntime — caller should.
 */
export async function syncProfileToPi(
  id: string,
  paths: ProviderPaths = defaultProviderPaths(),
  options: SyncProfileToPiOptions = {},
): Promise<ProviderActivateResult> {
  const updatePrefs = options.updatePrefs === true;
  const setActiveId = options.setActiveId !== false;

  const store = await loadStore(paths);
  const profile = store.profiles.find((p) => p.id === id);
  if (!profile) return { ok: false, error: "档案不存在" };
  if (!profile.enabled) return { ok: false, error: "档案未启用" };
  if (!profile.apiKey.trim()) return { ok: false, error: "API Key 为空" };
  const primary = profile.models[0];
  if (!primary?.id) return { ok: false, error: "档案没有可用模型" };

  ensureParent(paths.authPath);
  ensureParent(paths.modelsPath);

  const auth = await readJsonFile<Record<string, unknown>>(paths.authPath, {});
  // Drop DeepSeek vs deepseek style shadows only — never remove a different
  // providerId (e.g. deepseek vs deepseek-anthropic must coexist).
  pruneStaleProviderKeys(auth, profile.providerId);
  auth[profile.providerId] = {
    type: "api_key",
    key: profile.apiKey,
  };
  await writeFile(paths.authPath, JSON.stringify(auth, null, 2), "utf8");

  const modelsFile = await readJsonFile<{
    providers?: Record<string, unknown>;
  }>(paths.modelsPath, { providers: {} });
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
  await writeFile(paths.modelsPath, JSON.stringify(modelsFile, null, 2), "utf8");

  if (setActiveId) {
    store.activeId = profile.id;
    await saveStore(paths, store);
  }

  if (updatePrefs) {
    void patchPrefs({
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

/**
 * Remove providerId from Pi auth/models when no *enabled* catalog profile
 * still uses it (match is case-insensitive, including DeepSeek vs deepseek).
 */
export async function pruneProviderIdFromPi(
  providerId: string,
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<void> {
  const keep = providerId.trim();
  if (!keep) return;
  const keepLower = keep.toLowerCase();
  const store = await loadStore(paths);
  if (
    store.profiles.some(
      (p) => p.providerId.toLowerCase() === keepLower && p.enabled,
    )
  ) {
    return;
  }

  ensureParent(paths.authPath);
  ensureParent(paths.modelsPath);

  const dropKeys = (obj: Record<string, unknown>): boolean => {
    let changed = false;
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase() === keepLower) {
        delete obj[key];
        changed = true;
      }
    }
    return changed;
  };

  const auth = await readJsonFile<Record<string, unknown>>(paths.authPath, {});
  if (dropKeys(auth)) {
    await writeFile(paths.authPath, JSON.stringify(auth, null, 2), "utf8");
  }

  const modelsFile = await readJsonFile<{
    providers?: Record<string, unknown>;
  }>(paths.modelsPath, { providers: {} });
  if (modelsFile.providers && dropKeys(modelsFile.providers)) {
    await writeFile(
      paths.modelsPath,
      JSON.stringify(modelsFile, null, 2),
      "utf8",
    );
  }
}

/**
 * Compat: ensure enabled + sync + optionally force prefs to primary model.
 */
export async function activateProviderProfile(
  id: string,
  paths: ProviderPaths = defaultProviderPaths(),
  options?: { updatePrefs?: boolean },
): Promise<ProviderActivateResult> {
  const store = await loadStore(paths);
  const idx = store.profiles.findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: "档案不存在" };
  if (!store.profiles[idx]!.enabled) {
    store.profiles[idx] = {
      ...store.profiles[idx]!,
      enabled: true,
      updatedAt: new Date().toISOString(),
    };
    await saveStore(paths, store);
  }
  return syncProfileToPi(id, paths, {
    updatePrefs: options?.updatePrefs !== false,
    setActiveId: true,
  });
}

/** @deprecated Use {@link syncProfileToPi}. */
export const syncActiveProfileToPi = syncProfileToPi;

export async function deactivateProviderProfile(
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<void> {
  const store = await loadStore(paths);
  store.activeId = null;
  await saveStore(paths, store);
}

/** Mark the catalog profile that owns provider/model as activeId (badge cache). */
export async function markProfileActiveForModel(
  provider: string,
  modelId: string,
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<void> {
  const store = await loadStore(paths);
  const match = store.profiles.find(
    (p) =>
      p.providerId === provider &&
      p.models.some((m) => m.id === modelId),
  );
  if (!match) return;
  if (store.activeId === match.id) return;
  store.activeId = match.id;
  await saveStore(paths, store);
}

/** Whether prefs still point at a model in this profile. */
export function profileMatchesPrefs(
  profile: { providerId: string; models: { id: string }[] },
  prefs: { provider: string | null; model: string | null },
): boolean {
  if (!prefs.provider || !prefs.model) return false;
  return (
    profile.providerId === prefs.provider &&
    profile.models.some((m) => m.id === prefs.model)
  );
}

/** Seed prefs from first synced profile when user has no model selected yet. */
export function shouldSeedPrefsOnSync(): boolean {
  const prefs = getCachedPrefs();
  return !prefs.provider || !prefs.model;
}

// Re-export atomic write for callers that need to write auth/models directly.
export { atomicWriteJson as writeJsonAtomic };