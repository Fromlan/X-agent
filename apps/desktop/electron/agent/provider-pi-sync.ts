import type { ProviderActivateResult } from "../../shared/ipc";
import { getCachedPrefs, patchPrefs } from "./prefs";
import { writeJsonAtomic } from "./lib/atomic-write";
import { withStoreLock } from "./lib/store-mutex";
import {
  modelEntryForPiModelsJson,
  pruneStaleProviderKeys,
} from "./provider-pi-models";
import {
  defaultProviderPaths,
  ensureParent,
  loadStore,
  readJsonFile,
  saveStoreUnlocked,
  type ProviderPaths,
} from "./provider-persist";
import { invalidateAuthCache } from "./auth-check";

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

  // auth.json 读-改-写在 per-path 锁内原子落盘:跨档案并发激活不再互踩丢 key。
  const auth = await withStoreLock(paths.authPath, async () => {
    const a = await readJsonFile<Record<string, unknown>>(paths.authPath, {});
    // Drop DeepSeek vs deepseek style shadows only — never remove a different
    // providerId (e.g. deepseek vs deepseek-anthropic must coexist).
    pruneStaleProviderKeys(a, profile.providerId);
    a[profile.providerId] = {
      type: "api_key",
      key: profile.apiKey,
    };
    await writeJsonAtomic(paths.authPath, a);
    return a;
  });
  invalidateAuthCache();

  // models.json 读-改-写同理,与 auth 各用各的锁(锁内无其他带锁调用,不死锁)。
  const modelsFile = await withStoreLock(paths.modelsPath, async () => {
    const m = await readJsonFile<{
      providers?: Record<string, unknown>;
    }>(paths.modelsPath, { providers: {} });
    if (!m.providers || typeof m.providers !== "object") {
      m.providers = {};
    }
    pruneStaleProviderKeys(m.providers, profile.providerId);
    // Full replace of this provider's model list (edit must drop removed ids).
    m.providers[profile.providerId] = {
      baseUrl: profile.baseUrl,
      api: profile.api,
      models: profile.models.map((entry) =>
        modelEntryForPiModelsJson(
          entry,
          profile.api,
          profile.providerId,
          profile.baseUrl,
        ),
      ),
    };
    await writeJsonAtomic(paths.modelsPath, m);
    return m;
  });

  if (setActiveId) {
    // B5: 在 storePath 锁内重读最新 store 再更新 activeId，避免用函数开头
    // 的陈旧快照全量回写覆盖并发 upsert / delete / setEnabled 的改动。
    await withStoreLock(paths.storePath, async () => {
      const fresh = await loadStore(paths);
      fresh.activeId = profile.id;
      await saveStoreUnlocked(paths, fresh);
    });
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
 * still uses it.
 *
 * 匹配分两步,保证历史档案(老版本曾给同 baseUrl 加过 `-2` 后缀)也能被清理:
 * 1. 大小写不敏感的 providerId 直接匹配 —— 删所有大小写变体。
 * 2. 没命中且档案带 baseUrl 时,按 baseUrl 家族兜底匹配 Pi models 里的条目,
 *    只删"baseUrl 完全一致"的 Pi key(避免误删 builtin OAuth 同名条目)。
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
  const ownProfile = store.profiles.find(
    (p) => p.providerId.toLowerCase() === keepLower,
  );
  const ownBaseUrl = ownProfile?.baseUrl.trim().replace(/\/+$/, "").toLowerCase();

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

  const dropByBaseUrl = (
    obj: Record<string, unknown>,
    baseUrl: string | undefined,
    models: Record<string, { baseUrl?: string }> | undefined,
  ): boolean => {
    if (!baseUrl || !models) return false;
    let changed = false;
    for (const key of Object.keys(obj)) {
      const cfg = models[key];
      if (!cfg) continue;
      const entryBase = (cfg.baseUrl ?? "").trim().replace(/\/+$/, "").toLowerCase();
      if (entryBase && entryBase === baseUrl) {
        delete obj[key];
        changed = true;
      }
    }
    return changed;
  };

  // auth.json 锁内读-改-写;prune 是幂等删除,锁保证并发 prune 的读基于最新值。
  const authChanged = await withStoreLock(paths.authPath, async () => {
    const a = await readJsonFile<Record<string, unknown>>(paths.authPath, {});
    const changed = dropKeys(a);
    if (changed) {
      await writeJsonAtomic(paths.authPath, a);
    }
    return changed;
  });
  if (authChanged) {
    invalidateAuthCache();
  }

  // models.json 锁内读-改-写,含 baseUrl 家族兜底清理。
  await withStoreLock(paths.modelsPath, async () => {
    const m = await readJsonFile<{
      providers?: Record<string, { baseUrl?: string }>;
    }>(paths.modelsPath, { providers: {} });
    let changed = false;
    if (m.providers && dropKeys(m.providers)) {
      changed = true;
    }
    // baseUrl 兜底:大小写匹配可能漏掉历史档案的拼写漂移(同 baseUrl 但 Pi key
    // 与档案 providerId 不一致)。只要档案带 baseUrl,始终按 baseUrl 扫一遍
    // 剩余 Pi key —— 同 baseUrl 的视为"指向同一供应商",一并清掉。
    if (ownBaseUrl && m.providers) {
      if (dropByBaseUrl(m.providers, ownBaseUrl, m.providers)) {
        changed = true;
      }
    }
    if (changed) {
      await writeJsonAtomic(paths.modelsPath, m);
    }
  });
}

/** Seed prefs from first synced profile when user has no model selected yet. */
export function shouldSeedPrefsOnSync(): boolean {
  const prefs = getCachedPrefs();
  return !prefs.provider || !prefs.model;
}