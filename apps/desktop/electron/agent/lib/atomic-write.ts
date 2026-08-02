/**
 * Atomic JSON file I/O — write to a sibling `.tmp` then rename over the target.
 * POSIX rename is atomic; Windows NTFS `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`
 * (which Node's `fs.rename` uses) is atomic on the same volume. Survives crashes
 * mid-write: the previous file remains intact until the rename commits.
 */
import { randomUUID } from "node:crypto";
import { rename, writeFile, readFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

function tmpPath(target: string): string {
  return `${target}.${Date.now()}.${randomUUID()}.tmp`;
}

/** 序列化并原子写入 JSON。失败时清理 tmp 文件,不污染目标文件。 */
export async function writeJsonAtomic<T>(
  filePath: string,
  data: T,
): Promise<void> {
  const payload = JSON.stringify(data, null, 2);
  const tmp = tmpPath(filePath);
  try {
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, filePath);
  } catch (err) {
    // 清理 tmp —— 但不要吞掉原始错误。
    try {
      await rename(tmp, `${tmp}.failed-${Date.now()}`);
    } catch {
      /* tmp 已被 rename 消耗或不存在;忽略 */
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

/** 检查文件是否存在(异步)。 */
export async function fileExistsAsync(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}