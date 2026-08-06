import { mkdirSync } from "node:fs";
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
import {
  writeJsonAtomic,
  readJsonAsync,
  fileExistsAsync,
} from "./lib/atomic-write";
import { withStoreLock } from "./lib/store-mutex";
import {
  createStore,
  StoreMutationAborted,
  type Store,
} from "./lib/store";
import * as providerPiSync from "./provider-pi-sync";
import { importExistingProviderProfiles } from "./provider-import";

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

/** Per-storePath Store 实例缓存(测试/多目录会传自定义 paths)。 */
const storeInstances = new Map<string, Store<ProviderStoreFile>>();

/**
 * 取(或建)绑定 storePath 的 Store。锁 key = storePath,与 saveStore /
 * loadStore 共用同一把 per-path 锁,upsert / setEnabled / delete 不再丢更新。
 */
function providerStore(paths: ProviderPaths): Store<ProviderStoreFile> {
  let store = storeInstances.get(paths.storePath);
  if (!store) {
    store = createStore<ProviderStoreFile>({
      filePath: paths.storePath,
      defaults: emptyStore(),
      decode: decodeProviderStore,
      encode: encodeProviderStore,
    });
    storeInstances.set(paths.storePath, store);
  }
  return store;
}

/** 解码盘上 JSON:apiKey 从加密形态解回明文(与旧 loadStore 行为一致)。 */
function decodeProviderStore(raw: unknown): ProviderStoreFile {
  const r = raw as Partial<ProviderStoreFile> | null;
  const profiles = (Array.isArray(r?.profiles) ? r.profiles : []).map((p) =>
    normalizeProfile(p as Partial<ProviderProfile>),
  );
  return {
    version: 1,
    activeId: r?.activeId ?? null,
    profiles,
  };
}

/** 编码落盘 JSON:apiKey 加密后再写(保持盘上形状不变)。 */
function encodeProviderStore(store: ProviderStoreFile): ProviderStoreFile {
  return {
    ...store,
    profiles: store.profiles.map((p) => ({
      ...p,
      apiKey: encryptSecret(p.apiKey),
    })),
  };
}

export async function readJsonFile<T>(
  path: string,
  fallback: T,
): Promise<T> {
  if (!(await fileExistsAsync(path))) return fallback;
  try {
    return await readJsonAsync<T>(path, fallback);
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

/**
 * 用户必须保留至少一个启用的供应商档案;否则 Pi auth/models 会被清空,
 * 顶栏模型列表空,无法发起请求。这是产品约束,而非临时状态。
 */
export const PROVIDER_LAST_ENABLED_ERROR =
  "必须至少保留一个启用的供应商，否则顶栏没有可用模型";

/**
 * 检查启用集合变更后是否仍满足"至少一个启用档案"。
 *
 * 用于 setEnabled / upsert-enabled 路径:
 * - nextEnabled=true:任意剩余档案即可满足(本条就变 enabled)
 * - nextEnabled=false:检查除 excludeId 之外的档案是否还有 enabled
 *
 * delete 路径请用 {@link hasOtherEnabledProfilePure},因为没有"把它替换成什么 enabled"的概念。
 */
function hasOtherEnabledProfile(
  profiles: readonly ProviderProfile[],
  excludeId: string,
  nextEnabled: boolean,
): boolean {
  if (nextEnabled) return true;
  return hasOtherEnabledProfilePure(profiles, excludeId);
}

/** 剩余档案(不含 excludeId)中是否还有 enabled? */
function hasOtherEnabledProfilePure(
  profiles: readonly ProviderProfile[],
  excludeId: string,
): boolean {
  for (const p of profiles) {
    if (p.id === excludeId) continue;
    if (p.enabled) return true;
  }
  return false;
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

export async function loadStore(
  paths: ProviderPaths,
): Promise<ProviderStoreFile> {
  ensureParent(paths.storePath);
  return providerStore(paths).reload();
}

export async function saveStore(
  paths: ProviderPaths,
  store: ProviderStoreFile,
): Promise<void> {
  ensureParent(paths.storePath);
  const serialized: ProviderStoreFile = {
    ...store,
    profiles: store.profiles.map((p) => ({
      ...p,
      apiKey: encryptSecret(p.apiKey),
    })),
  };
  // 串行化所有写,避免并发 upsert / setEnabled / delete 互踩。
  await withStoreLock(paths.storePath, () =>
    writeJsonAtomic(paths.storePath, serialized),
  );
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
    enabled: profile.enabled,
    updatedAt: profile.updatedAt,
    apiKeyHint: maskApiKey(profile.apiKey),
  };
}

async function applyPiSyncForProfile(
  profile: ProviderProfile,
  paths: ProviderPaths,
  previousProviderId: string | null,
): Promise<{ ok: boolean; error?: string; syncedToPi: boolean }> {
  const {
    syncProfileToPi,
    shouldSeedPrefsOnSync,
    pruneProviderIdFromPi,
  } = providerPiSync;

  if (
    previousProviderId &&
    previousProviderId !== profile.providerId
  ) {
    await pruneProviderIdFromPi(previousProviderId, paths);
  }

  if (!profile.enabled) {
    await pruneProviderIdFromPi(profile.providerId, paths);
    return { ok: true, syncedToPi: false };
  }

  const usingLiveAgentDir =
    paths.storePath === defaultProviderPaths().storePath;
  const synced = await syncProfileToPi(profile.id, paths, {
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
 *
 * 主路径:大小写不敏感地匹配 catalog 档案的 providerId,有任意 enabled 档案即放行。
 * 兜底:当传入的 providerId 不在 catalog 时,若传入了 baseUrl,则按 baseUrl 查找
 * catalog 中的档案——用于历史档案的 providerId 拼写漂移场景。
 * 既不在 catalog 又无 baseUrl 的(如未在 Pi 注册的)按"放行"处理,等价 builtin。
 */
export async function isProviderEnabledInCatalog(
  providerId: string,
  pathsOrBaseUrl?: ProviderPaths | string,
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<boolean> {
  // 兼容新签名 (providerId, baseUrl, paths) 与旧签名 (providerId, paths)。
  const baseUrl =
    typeof pathsOrBaseUrl === "string" ? pathsOrBaseUrl : undefined;
  const resolvedPaths: ProviderPaths =
    typeof pathsOrBaseUrl === "object"
      ? (pathsOrBaseUrl as ProviderPaths)
      : paths;
  const key = providerId.trim().toLowerCase();
  if (!key) return false;
  const store = await loadStore(resolvedPaths);
  const managed = store.profiles.filter(
    (p) => p.providerId.toLowerCase() === key,
  );
  if (managed.length === 0) {
    // providerId 不在 catalog,尝试 baseUrl 兜底。
    if (baseUrl) {
      const norm = baseUrl.trim().replace(/\/+$/, "").toLowerCase();
      if (!norm) return true;
      return store.profiles.some(
        (p) =>
          p.enabled &&
          p.baseUrl.trim().replace(/\/+$/, "").toLowerCase() === norm,
      );
    }
    return true;
  }
  return managed.some((p) => p.enabled);
}

/** Drop models whose provider is a disabled catalog profile. */
export async function filterModelsByCatalogEnabled<
  T extends { provider: string; baseUrl?: string },
>(
  models: readonly T[],
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<T[]> {
  const store = await loadStore(paths);
  if (store.profiles.length === 0) return [...models];

  const enabledByProvider = new Map<string, boolean>();
  for (const p of store.profiles) {
    const key = p.providerId.toLowerCase();
    enabledByProvider.set(
      key,
      (enabledByProvider.get(key) ?? false) || p.enabled,
    );
  }

  // baseUrl 兜底用于处理历史档案的 providerId 拼写/大小写漂移:
  // 例如老版本 import 时给同 baseUrl 加了 "-2" 后缀,Pi 仍按原始 key 暴露。
  // 只有"catalog 中存在任意档案(不论 enabled)共享此 baseUrl"时,才把带该
  // baseUrl 但 provider 不在 catalog 的模型视为指向档案 —— 否则 Pi OAuth
  // builtin 等未在 catalog 的端点会被误伤。
  const catalogBaseUrls = new Set<string>();
  for (const p of store.profiles) {
    const base = p.baseUrl.trim().replace(/\/+$/, "").toLowerCase();
    if (base) catalogBaseUrls.add(base);
  }

  return models.filter((m) => {
    const key = m.provider.toLowerCase();
    if (enabledByProvider.has(key)) {
      return enabledByProvider.get(key) === true;
    }
    if (m.baseUrl) {
      const modelBase = m.baseUrl.trim().replace(/\/+$/, "").toLowerCase();
      // baseUrl 命中 catalog 内某条档案:
      //   若该档案 enabled 则放行;否则视为指向 disabled 档案,隐藏。
      if (modelBase && catalogBaseUrls.has(modelBase)) {
        return store.profiles.some(
          (p) =>
            p.enabled &&
            p.baseUrl.trim().replace(/\/+$/, "").toLowerCase() === modelBase,
        );
      }
    }
    return true;
  });
}

export async function listProviderProfiles(
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<ProviderProfileSummary[]> {
  // First launch: seed profiles from Pi auth/models and cc-switch if present.
  if (!(await fileExistsAsync(paths.storePath))) {
    await importExistingProviderProfiles(paths);
  }
  const store = await loadStore(paths);
  return store.profiles
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((p) => toSummary(p));
}

export async function getProviderProfile(
  id: string,
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<ProviderProfile | null> {
  const store = await loadStore(paths);
  return store.profiles.find((p) => p.id === id) ?? null;
}

export async function upsertProviderProfile(
  input: ProviderUpsertInput,
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<{
  ok: boolean;
  profile?: ProviderProfile;
  error?: string;
  /** True when the profile was written into Pi auth/models. */
  syncedToPi?: boolean;
}> {
  const err = validateUpsert(input);
  if (err) return { ok: false, error: err };

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

  // 结果经对象容器传出(闭包内赋值不会被 TS 窄化误判为 never)。
  const outcome: {
    profile: ProviderProfile | null;
    previousProviderId: string | null;
  } = { profile: null, previousProviderId: null };

  ensureParent(paths.storePath);
  try {
    // 锁内读-改-写:并发 upsert / setEnabled / delete 各自基于最新落盘值,
    // 不再出现"锁外读同一 base,后写覆盖前写"的丢更新。
    await providerStore(paths).mutate((store) => {
      if (input.id) {
        const idx = store.profiles.findIndex((p) => p.id === input.id);
        if (idx < 0) throw new StoreMutationAborted("档案不存在");
        const prev = store.profiles[idx]!;
        outcome.previousProviderId = prev.providerId;
        const nextEnabled =
          input.enabled !== undefined ? input.enabled !== false : prev.enabled;
        // 编辑路径下也不允许把唯一启用档案改成 disabled。
        if (
          prev.enabled &&
          !nextEnabled &&
          !hasOtherEnabledProfile(store.profiles, prev.id, nextEnabled)
        ) {
          throw new StoreMutationAborted(PROVIDER_LAST_ENABLED_ERROR);
        }
        outcome.profile = {
          ...prev,
          name: input.name.trim(),
          providerId: input.providerId.trim(),
          api: input.api,
          baseUrl: input.baseUrl.trim().replace(/\/$/, ""),
          apiKey: input.apiKey.trim(),
          models,
          notes: input.notes?.trim() || undefined,
          updatedAt: now,
          enabled: nextEnabled,
        };
        store.profiles[idx] = outcome.profile;
      } else {
        outcome.profile = {
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
        store.profiles.push(outcome.profile);
      }
      return store;
    });
  } catch (caught) {
    // 校验类中止(不写盘) vs 真实 I/O 错误(照常冒泡,与旧行为一致)。
    if (caught instanceof StoreMutationAborted) {
      return { ok: false, error: caught.message };
    }
    throw caught;
  }
  if (!outcome.profile) return { ok: false, error: "档案不存在" };

  const sync = await applyPiSyncForProfile(
    outcome.profile,
    paths,
    outcome.previousProviderId,
  );
  if (!sync.ok) {
    return { ok: false, error: sync.error };
  }

  return {
    ok: true,
    profile: outcome.profile,
    syncedToPi: sync.syncedToPi,
  };
}

export async function setProviderProfileEnabled(
  id: string,
  enabled: boolean,
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<{ ok: boolean; error?: string; syncedToPi?: boolean }> {
  const outcome: { profile: ProviderProfile | null } = { profile: null };

  ensureParent(paths.storePath);
  try {
    await providerStore(paths).mutate((store) => {
      const idx = store.profiles.findIndex((p) => p.id === id);
      if (idx < 0) throw new StoreMutationAborted("档案不存在");
      const prev = store.profiles[idx]!;
      const nextEnabled = enabled !== false;
      // 关掉当前档案后是否还有其它启用档案;没有则拒绝。
      if (
        prev.enabled &&
        !nextEnabled &&
        !hasOtherEnabledProfile(store.profiles, id, nextEnabled)
      ) {
        throw new StoreMutationAborted(PROVIDER_LAST_ENABLED_ERROR);
      }
      outcome.profile = {
        ...prev,
        enabled: nextEnabled,
        updatedAt: new Date().toISOString(),
      };
      store.profiles[idx] = outcome.profile;
      return store;
    });
  } catch (caught) {
    if (caught instanceof StoreMutationAborted) {
      return { ok: false, error: caught.message };
    }
    throw caught;
  }
  if (!outcome.profile) return { ok: false, error: "档案不存在" };

  const sync = await applyPiSyncForProfile(outcome.profile, paths, null);
  if (!sync.ok) {
    return { ok: false, error: sync.error };
  }
  return { ok: true, syncedToPi: sync.syncedToPi };
}

export async function deleteProviderProfile(
  id: string,
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<{ ok: boolean; error?: string; prunedProviderId?: string }> {
  const outcome: { profile: ProviderProfile | null } = { profile: null };

  ensureParent(paths.storePath);
  try {
    await providerStore(paths).mutate((store) => {
      const idx = store.profiles.findIndex((p) => p.id === id);
      if (idx < 0) throw new StoreMutationAborted("档案不存在");
      const target = store.profiles[idx]!;
      // 删除最后一个启用档案后,启用集合为空:拒绝。
      if (target.enabled && !hasOtherEnabledProfilePure(store.profiles, id)) {
        throw new StoreMutationAborted(PROVIDER_LAST_ENABLED_ERROR);
      }
      store.profiles.splice(idx, 1);
      if (store.activeId === id) {
        store.activeId = null;
      }
      outcome.profile = target;
      return store;
    });
  } catch (caught) {
    if (caught instanceof StoreMutationAborted) {
      return { ok: false, error: caught.message };
    }
    throw caught;
  }
  if (!outcome.profile) return { ok: false, error: "档案不存在" };

  const { pruneProviderIdFromPi } = providerPiSync;
  await pruneProviderIdFromPi(outcome.profile.providerId, paths);

  return { ok: true, prunedProviderId: outcome.profile.providerId };
}