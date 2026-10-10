/**
 * Atomic JSON file I/O — write to a sibling `.tmp` then rename over the target.
 * POSIX rename is atomic; Windows NTFS `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`
 * (which Node's `fs.rename` uses) is atomic on the same volume. Survives crashes
 * mid-write: the previous file remains intact until the rename commits.
 */
import { randomUUID } from "node:crypto";
import {
  rename as renameAsync,
  writeFile as writeFileAsync,
  readFile,
  access,
  unlink,
} from "node:fs/promises";
import {
  renameSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  constants as fsConstants,
} from "node:fs";

function tmpPath(target: string): string {
  return `${target}.${Date.now()}.${randomUUID()}.tmp`;
}

/** 序列化并原子写入 JSON。失败时清理 tmp 文件，不污染目标文件。 */
export async function writeJsonAtomic<T>(
  filePath: string,
  data: T,
): Promise<void> {
  const payload = JSON.stringify(data, null, 2);
  const tmp = tmpPath(filePath);
  try {
    await writeFileAsync(tmp, payload, "utf8");
    await renameAsync(tmp, filePath);
  } catch (err) {
    // 清理 tmp —— 但不要吞掉原始错误。
    try {
      await unlink(tmp);
    } catch {
      /* tmp 已被 rename 消耗或不存在;忽略 */
    }
    throw err;
  }
}

/**
 * 同步版原子写入：用于 journal / plan / goal 这类需要立即持久化的同步路径。
 * 失败时同样清理 tmp；调用方通常用 try/catch 降级到 console.warn。
 */
export function writeJsonAtomicSync<T>(filePath: string, data: T): void {
  const payload = JSON.stringify(data, null, 2);
  const tmp = tmpPath(filePath);
  try {
    writeFileSync(tmp, payload, "utf8");
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}

/** 异步读 JSON;不存在或解析失败返回 fallback。 */
export async function readJsonAsync<T>(
  filePath: string,
  fallback: T,
): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Fail closed on unreadable or corrupt JSON; only ENOENT initializes defaults. Never include raw content in errors. */
export async function readJsonStrict<T>(filePath: string, fallback: T): Promise<T> {
  let raw: string;
  try { raw = await readFile(filePath, "utf8"); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(fallback);
    throw new Error(`配置不可读取，已保留原文件 (${(err as NodeJS.ErrnoException).code ?? "I/O"})`);
  }
  try { return JSON.parse(raw) as T; }
  catch { throw new Error("配置 JSON 损坏，已保留原文件；请修复或备份后重试"); }
}

/** Synchronous strict reader for shared Pi settings; matches the async corruption policy. */
export function readJsonStrictSync<T>(filePath: string, fallback: T): T {
  let raw: string;
  try { raw = readFileSync(filePath, "utf8"); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(fallback);
    throw new Error(`配置不可读取，已保留原文件 (${(err as NodeJS.ErrnoException).code ?? "I/O"})`);
  }
  try { return JSON.parse(raw) as T; }
  catch { throw new Error("配置 JSON 损坏，已保留原文件；请修复或备份后重试"); }
}

/** Validate an object without coercion or dropping unknown fields shared with Pi CLI. */
export function requireJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("配置结构不合法，已保留原文件");
  return value as Record<string, unknown>;
}

/** 检查文件是否存在(异步)。 */
export async function fileExistsAsync(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}
