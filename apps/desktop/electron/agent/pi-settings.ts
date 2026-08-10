/**
 * Read-modify-write for ~/.pi/agent/settings.json (shared with Pi CLI).
 * Synchronous + tmp/rename atomic: JS single-thread makes the read-modify-write
 * atomic within the app (the two writers — bash shellPath / package sources —
 * can no longer overwrite each other's fields), and a crash mid-write cannot
 * truncate the file (the previous file stays intact until the rename commits).
 */
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getAgentDirPath } from "./prefs";

/** Absolute path of the shared Pi settings.json. */
export function piSettingsPath(): string {
  return join(getAgentDirPath(), "settings.json");
}

/**
 * 同步完成 settings.json 的读-改-写：`fn` 修改传入对象后整体原子落盘。
 * 解析失败（缺失/损坏）时以空对象开始；写失败向上抛错。
 */
export function mutatePiSettingsSync(
  fn: (settings: Record<string, unknown>) => void,
): void {
  const path = piSettingsPath();
  mkdirSync(getAgentDirPath(), { recursive: true });
  let settings: Record<string, unknown> = {};
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      settings = parsed as Record<string, unknown>;
    }
  } catch {
    settings = {};
  }
  fn(settings);
  const tmp = `${path}.${Date.now()}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** 读 settings.json 当前内容（仅供测试断言，生产路径请直接调用 `mutatePiSettingsSync`）。 */
export function readPiSettingsSync(): Record<string, unknown> {
  try {
    const raw = readFileSync(piSettingsPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}
