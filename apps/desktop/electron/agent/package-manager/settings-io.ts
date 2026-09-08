/**
 * package-manager / settings-io —— Pi settings.json `packages` 列表 I/O
 * (issue #68 主题 J C-106, 2026-08-31 收口).
 *
 * 唯一职责: 读 / 写 ~/.pi/agent/settings.json 的 `packages` 数组, 与
 * bash-check (E6) 共享 `mutatePiSettingsSync` 同步原子写. 不碰 catalog
 * (catalog.ts) / spawn (spawn.ts) / godot-pi 包装 (godot-pi.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDirPath } from "../prefs";
import { mutatePiSettingsSync } from "../pi-settings";

/** Path to Pi settings.json — shared with bash-check / provider I/O. */
export function settingsPath(): string {
  return join(getAgentDirPath(), "settings.json");
}

/** Paths recorded in Pi settings.json `packages` (same source as `pi list`). */
export function readPiSettingsPackageSources(): string[] {
  const path = settingsPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      packages?: unknown;
    };
    if (!Array.isArray(raw.packages)) return [];
    return raw.packages.filter(
      (p): p is string => typeof p === "string" && Boolean(p.trim()),
    );
  } catch {
    return [];
  }
}

/** Write `packages` into settings.json, preserving other keys. */
export function writePiSettingsPackageSources(packages: string[]): void {
  // E6: 与 bash-check 共用 settings.json 的同步原子写，字段互不覆盖。
  mutatePiSettingsSync((settings) => {
    settings.packages = packages;
  });
}
