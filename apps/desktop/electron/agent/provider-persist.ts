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
import {
  decryptSecretResult,
  encryptSecret,
} from "./secret-codec";
import { validateExternalHttpUrl, validateOutboundHttpUrl } from "./external-url";
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
      apiKey: serializeApiKey(p),
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
  // 解密失败（换机器 / 密钥环重置）时保留原密文到 encryptedKey，
  // 保存路径据此写回原密文，避免空串覆盖导致密钥永久丢失。
  const rawKey = typeof p.apiKey === "string" ? p.apiKey : "";
  const dec = decryptSecretResult(rawKey);
  return {
    id: typeof p.id === "string" ? p.id : randomUUID(),
    name: typeof p.name === "string" ? p.name : "",
    providerId: typeof p.providerId === "string" ? p.providerId : "",
    api: (p.api as ProviderApiKind) ?? "openai-completions",
    baseUrl: typeof p.baseUrl === "string" ? p.baseUrl : "",
    apiKey: dec.value,
    models: Array.isArray(p.models) ? p.models : [],
    notes: typeof p.notes === "string" ? p.notes : undefined,
    updatedAt:
      typeof p.updatedAt === "string"
        ? p.updatedAt
        : new Date().toISOString(),
    enabled: normalizeEnabled(p.enabled),
    ...(dec.ok ? {} : { encryptedKey: rawKey }),
  };
}

/** 落盘时序列化 apiKey：解密失败的档案写回原密文而非空串。 */
export function serializeApiKey(profile: ProviderProfile): string {
  if (profile.apiKey) return encryptSecret(profile.apiKey);
  if (profile.encryptedKey) return profile.encryptedKey;
  return "";
}

export async function loadStore(
  paths: ProviderPaths,
): Promise<ProviderStoreFile> {
  ensureParent(paths.storePath);
  return providerStore(paths).reload();
}

/**
 * 无锁版落盘（供已持 storePath 锁的调用方复用，避免嵌套锁死）。
 * 与 saveStore 完全一致：serializeApiKey + 原子写。
 */
export async function saveStoreUnlocked(
  paths: ProviderPaths,
  store: ProviderStoreFile,
): Promise<void> {
  ensureParent(paths.storePath);
  const serialized: ProviderStoreFile = {
    ...store,
    profiles: store.profiles.map((p) => ({
      ...p,
      apiKey: serializeApiKey(p),
    })),
  };
  await writeJsonAtomic(paths.storePath, serialized);
}

export async function saveStore(
  paths: ProviderPaths,
  store: ProviderStoreFile,
): Promise<void> {
  // 串行化所有写,避免并发 upsert / setEnabled / delete 互踩。
  await withStoreLock(paths.storePath, () => saveStoreUnlocked(paths, store));
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "(未设置)";
  if (trimmed.length <= 8) return "••••";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function validateUpsert(input: ProviderUpsertInput): string | null {
  if (!input.name.trim()) return "名称不能为空";
  if (!/^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/i.test(input.providerId.trim())) {
    return "providerId 须为字母数字/_/-";
  }
  if (!API_KINDS.includes(input.api)) return "不支持的 API 类型";
  if (!input.baseUrl.trim()) return "baseUrl 不能为空";
  // 仅接受 http(s) 且 host 非本地/私网/重绑定域（与模型 fetch 的 SSRF 闸一致；
  // 本地 LLM 需经公网代理中转）。
  const checked = validateExternalHttpUrl(input.baseUrl.trim());
  if (!checked.ok) {
    return `baseUrl 不被允许：${checked.error}`;
  }
  if (!input.apiKey.trim()) return "API Key 不能为空";
  if (!input.models.length || !input.models.some((m) => m.id.trim())) {
    return "至少需要一个模型 id";
  }
  return null;
}

/**
 * 异步校验：当前 Pi DNS 解析是否安全（防 DNS rebinding 在保存与实际请求之间
 * 切换解析结果）。Provider 档案先走 `validateUpsert` 静态闸，再过本闸。
 * 返回 null 表示通过；否则返回人类可读错误。
 */
export async function validateUpsertAsync(
  input: ProviderUpsertInput,
): Promise<string | null> {
  const sync = validateUpsert(input);
  if (sync) return sync;
  const checked = await validateOutboundHttpUrl(input.baseUrl.trim());
  if (!checked.ok) {
    return `baseUrl 不被允许：${checked.error}`;
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

/**
 * Drop models whose provider is disabled in the catalog, and also models the
 * catalog profile does not list.
 *
 * Pi's ModelRuntime merges models.json onto its BUILTIN provider catalog
 * (provider-composer applyModelsJson keeps every builtin model and only
 * overrides/appends ids from models.json).  A profile edit that removes a
 * model therefore must hide the leftover builtin entries here — otherwise
 * deleted models keep showing in the TopBar picker.
 *
 * Matching rules per model:
 * - provider present in catalog (case-insensitive): visible only when some
 *   profile is enabled AND its id is listed by that provider's profiles.
 * - provider absent but baseUrl matches a catalog profile: treat as that
 *   profile (legacy providerId spelling drift), same id-level gate.
 * - otherwise (Pi OAuth builtins, unmanaged endpoints): passthrough.
 */
export async function filterModelsByCatalogEnabled<
  T extends { provider: string; id: string; baseUrl?: string },
>(
  models: readonly T[],
  paths: ProviderPaths = defaultProviderPaths(),
): Promise<T[]> {
  const store = await loadStore(paths);
  if (store.profiles.length === 0) return [...models];

  // providerId(lower) -> enabled flag + declared model ids (case-insensitive).
  const byProvider = new Map<
    string,
    { enabled: boolean; modelIds: Set<string> }
  >();
  // baseUrl(lower) -> same shape, for providerId spelling-drift fallback.
  const byBaseUrl = new Map<
    string,
    { enabled: boolean; modelIds: Set<string> }
  >();

  for (const p of store.profiles) {
    const key = p.providerId.toLowerCase();
    const entry =
      byProvider.get(key) ?? { enabled: false, modelIds: new Set<string>() };
    entry.enabled = entry.enabled || p.enabled;
    for (const m of p.models) entry.modelIds.add(m.id.trim().toLowerCase());
    byProvider.set(key, entry);

    const base = p.baseUrl.trim().replace(/\/+$/, "").toLowerCase();
    if (base) {
      const baseEntry =
        byBaseUrl.get(base) ?? { enabled: false, modelIds: new Set<string>() };
      baseEntry.enabled = baseEntry.enabled || p.enabled;
      for (const m of p.models) baseEntry.modelIds.add(m.id.trim().toLowerCase());
      byBaseUrl.set(base, baseEntry);
    }
  }

  const visibleBy = (
    entry: { enabled: boolean; modelIds: Set<string> } | undefined,
    modelId: string,
  ): boolean => {
    if (!entry) return true;
    if (!entry.enabled) return false;
    return entry.modelIds.has(modelId.trim().toLowerCase());
  };

  return models.filter((m) => {
    const key = m.provider.toLowerCase();
    if (byProvider.has(key)) {
      return visibleBy(byProvider.get(key), m.id);
    }
    if (m.baseUrl) {
      const modelBase = m.baseUrl.trim().replace(/\/+$/, "").toLowerCase();
      if (modelBase) {
        // baseUrl 命中 catalog 内某条档案:
        //   若该档案 enabled 且声明了此模型 id 则放行;否则隐藏。
        return visibleBy(byBaseUrl.get(modelBase), m.id);
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
  // 1.3 防御：先静态校验（host 黑名单），再异步 DNS 校验，关闭
  // DNS rebinding 在保存与实际请求之间切换解析结果的窗口。
  const err = await validateUpsertAsync(input);
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