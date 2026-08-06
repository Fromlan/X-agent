/**
 * Deep-module JSON store: one `Store<T>` owns the read-modify-write cycle for a
 * single file. `mutate` runs the whole load → change → persist sequence inside
 * the per-path store lock (store-mutex.ts), so concurrent mutators can never
 * read the same base and overwrite each other — the lossy "read outside lock,
 * write inside lock" pattern previously used by prefs / usage / provider
 * stores (commit a167c51 fixed it only partially).
 *
 * Disk JSON shape is fully controlled by the caller via `decode`/`encode`;
 * this module never re-shapes data, it only serializes access + keeps a
 * synchronous read cache for hot paths.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJsonAsync, writeJsonAtomic } from "./atomic-write";
import { withStoreLock } from "./store-mutex";

export interface StoreOptions<T> {
  /** Absolute JSON path, or a lazy getter (test overrides move the file at runtime). */
  filePath: string | (() => string);
  /** Base value used when the file is missing / unparsable; cloned per read. */
  defaults: T;
  /** Optional transform from raw disk JSON to the in-memory shape. */
  decode?: (raw: unknown) => T;
  /** Optional transform from the in-memory shape to disk JSON (e.g. secret encryption). */
  encode?: (value: T) => unknown;
  /** Fallback when the atomic write throws (e.g. Windows EPERM); the value stays cached. */
  onWriteError?: (err: unknown, value: T) => Promise<void> | void;
}

export interface Store<T> {
  /** 同步缓存读;缓存为空或路径已变(测试 override)时同步读盘兜底。 */
  read(): T;
  /** 异步重读磁盘并刷新缓存。 */
  reload(): Promise<T>;
  /** 锁内完整读-改-写循环;fn 抛错则中止,不写盘不更新缓存。 */
  mutate(fn: (prev: T) => T): Promise<T>;
  /** 锁内整体替换落盘并刷新缓存。 */
  write(value: T): Promise<T>;
  /** 启动预热 / 测试钩子:只填缓存,不碰磁盘。 */
  prime(value: T): void;
}

/** Thrown by mutate fns to abort a mutation without touching the disk. */
export class StoreMutationAborted extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreMutationAborted";
  }
}

/**
 * Create a Store bound to one file. Cache / lock key are both derived from
 * `options.filePath`, so Store instances sharing a path also share the lock.
 */
export function createStore<T>(options: StoreOptions<T>): Store<T> {
  let cache: T | null = null;
  let cachePath: string | null = null;

  const resolvePath = (): string =>
    typeof options.filePath === "function" ? options.filePath() : options.filePath;

  /** 写盘前确保父目录存在(atomic-write 的 tmp 文件落在同一目录)。 */
  const ensureParentDir = (path: string): void => {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      // EEXIST 等忽略;幂等 mkdir
    }
  };

  /** 解码原始磁盘 JSON;decode 抛错(损坏数据)时回退 defaults,不让写路径炸掉。 */
  const decodeValue = (raw: unknown): T => {
    try {
      return options.decode ? options.decode(raw) : (raw as T);
    } catch {
      return structuredClone(options.defaults);
    }
  };

  /** 同步读盘:文件不存在 / 解析失败 → defaults。 */
  const readFromDiskSync = (): T => {
    try {
      const raw = JSON.parse(readFileSync(resolvePath(), "utf8")) as unknown;
      return decodeValue(raw);
    } catch {
      return structuredClone(options.defaults);
    }
  };

  /** 异步读盘:文件不存在 / 解析失败 → defaults。 */
  const readFromDiskAsync = async (): Promise<T> => {
    const raw = await readJsonAsync<unknown>(resolvePath(), null);
    return raw === null ? structuredClone(options.defaults) : decodeValue(raw);
  };

  const read = (): T => {
    const path = resolvePath();
    // 路径切换(惰性 getter / 测试 override)时缓存失效,避免返回旧文件的值。
    if (cache !== null && cachePath === path) return cache;
    const value = readFromDiskSync();
    cache = value;
    cachePath = path;
    return value;
  };

  const reload = async (): Promise<T> => {
    const path = resolvePath();
    const value = await readFromDiskAsync();
    cache = value;
    cachePath = path;
    return value;
  };

  const mutate = async (fn: (prev: T) => T): Promise<T> => {
    const path = resolvePath();
    // 整个读-改-写循环在 per-path 锁内:并发 mutate 覆盖彼此的窗口被消除。
    return withStoreLock(path, async () => {
      const prev = await readFromDiskAsync();
      const next = fn(prev); // fn 抛错(如 StoreMutationAborted)时中止,不写盘不更新缓存。
      ensureParentDir(path);
      try {
        await writeJsonAtomic(path, options.encode ? options.encode(next) : next);
      } catch (err) {
        if (options.onWriteError) {
          await options.onWriteError(err, next);
        } else {
          throw err;
        }
      }
      cache = next;
      cachePath = path;
      return next;
    });
  };

  const write = async (value: T): Promise<T> => {
    const path = resolvePath();
    await withStoreLock(path, async () => {
      ensureParentDir(path);
      try {
        await writeJsonAtomic(path, options.encode ? options.encode(value) : value);
      } catch (err) {
        if (options.onWriteError) {
          await options.onWriteError(err, value);
        } else {
          throw err;
        }
      }
      cache = value;
      cachePath = path;
    });
    return value;
  };

  const prime = (value: T): void => {
    cache = value;
    cachePath = resolvePath();
  };

  return { read, reload, mutate, write, prime };
}
