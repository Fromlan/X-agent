import type { ProviderActivateResult } from "../../shared/ipc";
import { getCachedPrefs, patchPrefs } from "./prefs";
import { withStoreLock } from "./lib/store-mutex";
import {
  modelEntryForPiModelsJson,
  pruneStaleProviderKeys,
} from "./provider-pi-models";
import {
  defaultProviderPaths,
  ensureParent,
  loadStore,
  saveStoreUnlocked,
  type ProviderPaths,
} from "./provider-persist";
import { invalidateAuthCache } from "./auth-check";
import {
  type PiAuthFile,
  withAuthLock,
  readAuthFile,
  writeAuthFile,
} from "./provider-pi-sync/pi-auth-port";
import {
  type PiModelEntry,
  type PiModelsFile,
  withModelsLock,
  readModelsFile,
  writeModelsFile,
} from "./provider-pi-sync/pi-models-port";

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
 *
 * 2026-08-31 收口 (issue #68 主题 J C-105): 原本散在函数里的 readJsonFile /
 * writeJsonAtomic / withStoreLock 三件套抽到 pi-auth-port / pi-models-port.
 * syncProfileToPi 只剩 orchestration (校验 + 各 port 调用 + store / prefs 更新).
 */
export async function syncProfileToPi(
  id: string,
  paths: ProviderPaths = defaultProviderPaths(),
  options: SyncProfileToPiOptions = {},
): Promise<ProviderActivateResult> {
  if (SKIP_PI_SYNC_FOR_TESTS) {
    // 测试模式:跳过真实 Pi 写盘,只返回 ok 让上层逻辑跑通。
    const store = await loadStore(paths);
    const profile = store.profiles.find((p) => p.id === id);
    if (!profile) return { ok: false, error: "档案不存在" };
    return { ok: true, provider: profile.providerId, model: profile.models[0]?.id ?? "" };
  }
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

  // Preflight both shared files before publishing either; per-file locks still protect each mutation.
  await readAuthFile(paths);
  await readModelsFile(paths);

  // auth.json: 锁内 read-modify-write, 跨档案并发激活不再互踩丢 key。
  await withAuthLock(paths, (auth) => {
    // Drop DeepSeek vs deepseek style shadows only — never remove a different
    // providerId (e.g. deepseek vs deepseek-anthropic must coexist).
    pruneStaleProviderKeys(auth, profile.providerId);
    auth[profile.providerId] = {
      type: "api_key",
      key: profile.apiKey,
    };
    return writeAuthFile(paths, auth);
  });
  invalidateAuthCache();

  // models.json: 同理, 与 auth 各用各的锁 (锁内无其他带锁调用, 不死锁)。
  await withModelsLock(paths, (m: PiModelsFile) => {
    if (!m.providers || typeof m.providers !== "object") {
      m.providers = {};
    }
    pruneStaleProviderKeys(m.providers, profile.providerId);
    // Full replace of this provider's model list (edit must drop removed ids).
    m.providers[profile.providerId] = {
      baseUrl: profile.baseUrl,
      api: profile.api,
      // modelEntryForPiModelsJson 返回 Record<string, unknown>, Pi 强依赖 id 字段
      // (已在 modelEntryForPiModelsJson 内部写入 entry.id). 强转数组类型.
      models: profile.models.map(
        (entry) =>
          modelEntryForPiModelsJson(
            entry,
            profile.api,
            profile.providerId,
            profile.baseUrl,
          ) as unknown as PiModelEntry,
      ),
    };
    return writeModelsFile(paths, m);
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
 * Only an explicitly owned provider ID (case-insensitive) may be removed.
 * Sharing a baseUrl is not evidence of ownership: CLI profiles and different API protocols can coexist there.
 *
 * 2026-08-31 收口 (issue #68 主题 J C-105): 走 pi-auth-port / pi-models-port
 * 抽象, read-modify-write 不再内联 readJsonFile / writeJsonAtomic /
 * withStoreLock 三件套.
 */
export async function pruneProviderIdFromPi(
  providerId: string,
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<void> {
  if (SKIP_PI_SYNC_FOR_TESTS) return;
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


  // auth.json: 锁内读-改-写, prune 是幂等删除, 锁保证并发 prune 的读基于最新值。
  const authChanged = await withAuthLock(paths, async (a: PiAuthFile) => {
    const changed = dropKeys(a);
    if (changed) {
      await writeAuthFile(paths, a);
    }
    return changed;
  });
  if (authChanged) {
    invalidateAuthCache();
  }

  // models.json: 锁内读-改-写, 含 baseUrl 家族兜底清理。
  await withModelsLock(paths, (m: PiModelsFile) => {
    let changed = false;
    if (m.providers && dropKeys(m.providers)) {
      changed = true;
    }
    if (changed) {
      return writeModelsFile(paths, m);
    }
    return undefined;
  });
}

/** Seed prefs from first synced profile when user has no model selected yet. */
export function shouldSeedPrefsOnSync(): boolean {
  const prefs = getCachedPrefs();
  return !prefs.provider || !prefs.model;
}

/** 测试闸：跳过 syncProfileToPi / pruneProviderIdFromPi 真实写盘。 */
let SKIP_PI_SYNC_FOR_TESTS = false;
export function setSkipPiSyncForTests(skip: boolean): void {
  SKIP_PI_SYNC_FOR_TESTS = skip;
}
