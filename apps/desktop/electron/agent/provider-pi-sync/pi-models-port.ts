/**
 * Pi models.json 端口 (issue #68 主题 J C-105, 2026-08-31).
 *
 * 封装 Pi models.json 的 read-modify-write:
 * - read: 默认空 providers (models.json 不存在 / 损坏时降级)
 * - write: 用 writeJsonAtomic 原子落盘
 * - lock: 跨并发 syncProfileToPi / pruneProviderIdFromPi 不互踩
 * - models 嵌套结构: { providers: { providerId: { baseUrl, api, models[] } } }
 *
 * 与 pi-auth-port.ts 对称设计, 模式一致.
 */
import { readJsonAsync, writeJsonAtomic } from "../lib/atomic-write";
import { withStoreLock } from "../lib/store-mutex";
import type { ProviderPaths } from "../provider-persist";

/** Pi models.json 中单个 provider 入口的 models 项.
 * 保留 id 为 string (Pi 强依赖), 其他字段放宽到 [k: string]: unknown
 * 以兼容 modelEntryForPiModelsJson 返回的 Record<string, unknown> 类型. */
export interface PiModelEntry {
  id: string;
  [k: string]: unknown;
}

/** Pi models.json 中单个 provider 入口. */
export interface PiProviderEntry {
  baseUrl?: string;
  api?: string;
  models: PiModelEntry[];
  [k: string]: unknown;
}

/** Pi models.json 顶层结构. */
export interface PiModelsFile {
  providers?: Record<string, PiProviderEntry>;
  [k: string]: unknown;
}

/** models.json lock key (per-path). */
function lockKey(path: ProviderPaths): string {
  return path.modelsPath;
}

/** 读 models.json, 不存在 / 损坏时返回空 providers. */
export async function readModelsFile(
  paths: ProviderPaths,
): Promise<PiModelsFile> {
  return readJsonAsync<PiModelsFile>(paths.modelsPath, {
    providers: {},
  });
}

/** 原子写 models.json (锁外调用方应包 withModelsLock). */
export async function writeModelsFile(
  paths: ProviderPaths,
  data: PiModelsFile,
): Promise<void> {
  await writeJsonAtomic(paths.modelsPath, data);
}

/** 锁内 read-modify-write: caller 提供 mutate 闭包. */
export async function withModelsLock<T>(
  paths: ProviderPaths,
  mutate: (models: PiModelsFile) => Promise<T> | T,
): Promise<T> {
  return withStoreLock(lockKey(paths), async () => {
    const models = await readModelsFile(paths);
    return mutate(models);
  });
}

/** 便捷: 返回 mutate 闭包是否修改了对象 (用于决定是否写盘). */
export function modelsChanged(
  before: PiModelsFile,
  after: PiModelsFile,
): boolean {
  // 简单 JSON 比对足够 (不深比较, 只看顶层引用是否变).
  return before !== after;
}
