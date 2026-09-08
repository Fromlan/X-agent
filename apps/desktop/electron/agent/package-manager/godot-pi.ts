/**
 * package-manager / godot-pi —— godot-pi 一键安装包装
 * (issue #68 主题 J C-106, 2026-08-31 收口).
 *
 * 唯一职责:
 * 1. 在 dev / packaged / cwd 候选路径中解析 godot-pi 包目录.
 * 2. 把 godot-pi 的 install / uninstall 经 installPackage / uninstallPackage
 *    转给顶层. 不直接调 spawn.
 *
 * 不在这里: registry / settings / spawn 细节. 复用 package-manager 顶层的
 * installPackage / uninstallPackage + catalog.ts 的 helpers.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PackageInstallResult } from "../../../shared/ipc";
import { checkPiCli } from "../pi-cli";
import {
  findLivePackageSourcesByName,
  GODOT_PI_PACKAGE_NAME,
  normalizeSourceKey,
  pruneMissingPiPackageSources,
  tryElectronPaths,
} from "./catalog";

/** Resolve bundled / workspace godot-pi package directory. */
export function resolveGodotPiPackagePath(): string | null {
  const candidates: string[] = [];
  const { resourcesPath, appPath } = tryElectronPaths();
  if (resourcesPath) {
    candidates.push(join(resourcesPath, "godot-pi"));
  }
  if (appPath) {
    candidates.push(join(appPath, "..", "..", "packages", "godot-pi"));
    candidates.push(join(appPath, "packages", "godot-pi"));
  }
  candidates.push(
    resolve(join(__dirname, "..", "..", "..", "..", "packages", "godot-pi")),
  );
  candidates.push(resolve(join(process.cwd(), "..", "..", "packages", "godot-pi")));
  candidates.push(resolve(join(process.cwd(), "packages", "godot-pi")));

  for (const c of candidates) {
    if (existsSync(join(c, "package.json"))) return resolve(c);
  }
  return null;
}

export async function installGodotPiPackage(): Promise<PackageInstallResult> {
  const path = resolveGodotPiPackagePath();
  if (!path) {
    return {
      ok: false,
      error:
        "未找到 packages/godot-pi。开发模式请在仓库根目录运行；打包版需包含 godot-pi 资源。",
    };
  }
  // Defer to the installPackage exported from the parent module to avoid
  // a circular import (catalog ← settings-io, godot-pi ← catalog,
  // package-manager ← godot-pi).
  const { installPackage } = await import("../package-manager");
  return installPackage(path);
}

/**
 * Install / refresh the native godot-pi package when missing or pointing at a
 * stale path. Does not throw; callers may ignore failures.
 */
export async function ensureGodotPiPackageInstalled(): Promise<{
  attempted: boolean;
  installed: boolean;
  /** Failure reason when attempted=true but installed=false. */
  error?: string;
  result?: PackageInstallResult;
}> {
  pruneMissingPiPackageSources();
  const path = resolveGodotPiPackagePath();
  if (!path) {
    return { attempted: false, installed: false, error: "无法定位内置 godot-pi 包路径" };
  }
  const live = findLivePackageSourcesByName(GODOT_PI_PACKAGE_NAME);
  const targetKey = normalizeSourceKey(path);
  if (live.some((s) => normalizeSourceKey(s) === targetKey)) {
    return { attempted: false, installed: true };
  }
  const cli = checkPiCli();
  if (!cli.ok) {
    return {
      attempted: false,
      installed: false,
      error: cli.message || "Pi CLI 未安装",
    };
  }
  // Defer to the installPackage exported from the parent module; it is
  // imported lazily here to avoid a circular module graph
  // (catalog ← settings-io, godot-pi ← catalog, package-manager ← godot-pi).
  const { installPackage } = await import("../package-manager");
  // installPackage uninstalls other same-name paths, then installs `path`.
  const result = await installPackage(path);
  return {
    attempted: true,
    installed: result.ok,
    ...(result.ok ? {} : { error: result.error ?? "内置 Package 安装失败" }),
    result,
  };
}
