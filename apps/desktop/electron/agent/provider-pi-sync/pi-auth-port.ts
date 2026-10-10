/**
 * Pi auth.json 端口 (issue #68 主题 J C-105, 2026-08-31).
 *
 * 封装 Pi auth.json 的 read-modify-write:
 * - read: initialize only missing files; reject corrupt/unreadable data without overwriting it
 * - write: 用 writeJsonAtomic 原子落盘 (tmp + rename)
 * - lock: 跨并发 syncProfileToPi / pruneProviderIdFromPi 不互踩丢 key
 *
 * 把原本散在 syncProfileToPi / pruneProviderIdFromPi 里的
 * readJsonFile / writeJsonAtomic / withStoreLock 三件套合一.
 * 测试可 mock 整个 port 不用碰文件.
 */
import { readJsonStrict, requireJsonObject, writeJsonAtomic } from "../lib/atomic-write";
import { withStoreLock } from "../lib/store-mutex";
import type { ProviderPaths } from "../provider-persist";

/** Pi auth.json 顶层结构: providerId → { type, key } */
export type PiAuthFile = Record<string, { type: string; key: string }>;

/** auth.json lock key (per-path). */
function lockKey(path: ProviderPaths): string {
  return path.authPath;
}

/** Read auth.json strictly; preserve corrupt/unreadable files and unknown OAuth fields. */
export async function readAuthFile(
  paths: ProviderPaths,
): Promise<PiAuthFile> {
  const auth = requireJsonObject(await readJsonStrict<unknown>(paths.authPath, {}));
  for (const entry of Object.values(auth)) requireJsonObject(entry);
  return auth as PiAuthFile;
}

/** 原子写 auth.json (锁外调用方应包 withAuthLock). */
export async function writeAuthFile(
  paths: ProviderPaths,
  data: PiAuthFile,
): Promise<void> {
  await writeJsonAtomic(paths.authPath, data);
}

/** 锁内 read-modify-write: caller 提供 mutate 闭包. */
export async function withAuthLock<T>(
  paths: ProviderPaths,
  mutate: (auth: PiAuthFile) => Promise<T> | T,
): Promise<T> {
  return withStoreLock(lockKey(paths), async () => {
    const auth = await readAuthFile(paths);
    return mutate(auth);
  });
}
