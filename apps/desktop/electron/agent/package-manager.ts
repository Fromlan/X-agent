/**
 * package-manager —— App-managed Pi package installs (via `pi install`) +
 * Godot Pi one-click path (issue #68 主题 J C-106, 2026-08-31 收口).
 *
 * 原本单文件 852 行同时承担 4 件事: catalog 自愈 / settings.json I/O /
 * shell spawn / godot-pi 包装. 拆到 ./package-manager/ 四个 module 后,
 * 本文件只剩顶层 installPackage / uninstallPackage + 公共 re-export.
 *
 * List view 仍走 `listInstalledPackages`, 数据来源 = Pi `settings.json`
 * packages (same as `pi list`) + x-agent registry 仅供 metadata.
 *
 * 调用方 (plugin-host / app-runtime / electron/main IPC handler) 全部不动.
 */
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { InstalledPackageInfo, PackageInstallResult } from "../../shared/ipc";
import { checkPiCli } from "./pi-cli";
import { runPiPackageCommand } from "./package-manager/spawn";
import {
  dropRegistryPackagesBySource,
  findLivePackageSourcesByName,
  GODOT_PI_PACKAGE_NAME,
  isResolvablePackageSource,
  listInstalledPackages,
  packageNameForSource,
  pruneMissingPiPackageSources,
  readPiSettingsPackageSources,
  readRegistry,
  reconcilePackageCatalog,
  resolvePackageRoot,
  writeRegistry,
  enrichPackageCounts,
  invalidatePackageRootsCache,
  packageNameFromSource,
  normalizeSourceKey,
  getInstalledPackageRoots,
} from "./package-manager/catalog";

// Re-export catalog + settings helpers for callers that used to import
// from "./package-manager" directly.
export {
  dropRegistryPackagesBySource,
  findLivePackageSourcesByName,
  GODOT_PI_PACKAGE_NAME,
  getInstalledPackageRoots,
  isResolvablePackageSource,
  listInstalledPackages,
  packageNameForSource,
  pruneMissingPiPackageSources,
  readRegistry,
  reconcilePackageCatalog,
  resolvePackageRoot,
  writeRegistry,
  enrichPackageCounts,
  invalidatePackageRootsCache,
  readPiSettingsPackageSources,
  writePiSettingsPackageSources,
} from "./package-manager/catalog";

export { resolveGodotPiPackagePath } from "./package-manager/godot-pi";

/**
 * Package source whitelist gate before `pi install/uninstall <source>`
 * (which reaches cmd.exe on Windows). Allows:
 * - package-manager specs with known schemes: `npm:`, `git+`, `https:`, `ssh:`
 *   (mirrors `pruneMissingPiPackageSources`); no whitespace allowed
 * - existing local paths (resolved to an absolute path)
 * Anything else (shell metacharacters, unknown schemes, bare names) is
 * rejected so renderer input can never shape the spawned command line.
 */
export function isSafePackageSource(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  if (/^(npm:|git\+|https?:|ssh:)/i.test(trimmed)) {
    return !/\s/.test(trimmed);
  }
  try {
    return existsSync(trimmed) && statSync(trimmed).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Uninstall other live local copies of the same package name (different path).
 * Used before install so settings.json does not accumulate Electron temp paths.
 */
async function uninstallOtherSourcesForPackageName(
  packageName: string,
  keepSource: string,
): Promise<{ ok: boolean; error?: string; output: string }> {
  const keepKey = normalizeSourceKey(keepSource);
  const others = findLivePackageSourcesByName(packageName).filter(
    (s) => normalizeSourceKey(s) !== keepKey,
  );
  let output = "";
  for (const other of others) {
    const res = await uninstallPackage(other);
    output += (res.output ?? "") + "\n";
    if (!res.ok) {
      return {
        ok: false,
        error: res.error ?? `无法卸载旧路径：${other}`,
        output,
      };
    }
  }
  return { ok: true, output };
}

export async function installPackage(source: string): Promise<PackageInstallResult> {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: "安装源不能为空" };
  if (!isSafePackageSource(trimmed)) {
    return {
      ok: false,
      error:
        "安装源不合法：仅支持 npm: / git+ / https: / ssh: 形式的包源，或本机存在的包目录路径。",
    };
  }
  const cli = checkPiCli();
  if (!cli.ok || !cli.piPath) {
    return {
      ok: false,
      error:
        "需要全局 Pi CLI 才能安装 Packages。请先在设置中安装 Pi CLI，或手动执行 pi install。",
    };
  }
  pruneMissingPiPackageSources();
  const absSource = existsSync(trimmed) ? resolve(trimmed) : trimmed;
  const pkgName = packageNameForSource(absSource);
  let preOutput = "";
  if (pkgName) {
    const cleaned = await uninstallOtherSourcesForPackageName(pkgName, absSource);
    preOutput = cleaned.output;
    if (!cleaned.ok) {
      return {
        ok: false,
        error: cleaned.error,
        output: preOutput.trim().slice(-800),
      };
    }
  }
  // Already installed at this exact path after prune/dedupe — just refresh registry.
  if (
    pkgName &&
    readPiSettingsPackageSources().some(
      (s) => normalizeSourceKey(s) === normalizeSourceKey(absSource),
    )
  ) {
    const entry: InstalledPackageInfo = enrichPackageCounts({
      name: pkgName,
      source: absSource,
      installedAt: new Date().toISOString(),
      path: absSource,
    });
    const reg = readRegistry();
    let next = dropRegistryPackagesBySource(reg.packages, entry.source);
    next = next.filter((p) => p.name.toLowerCase() !== pkgName.toLowerCase());
    next.push(entry);
    writeRegistry({ packages: next });
    reconcilePackageCatalog();
    invalidatePackageRootsCache();
    return { ok: true, package: entry, output: preOutput.trim().slice(-400) };
  }
  const { code, output } = await runPiPackageCommand(
    cli.piPath,
    ["install", absSource],
    "install",
  );
  if (code !== 0) {
    return {
      ok: false,
      error: `pi install 失败（code=${code ?? "null"}）`,
      output: (preOutput + output).trim().slice(-800),
    };
  }
  const entry: InstalledPackageInfo = enrichPackageCounts({
    name: packageNameFromSource(
      absSource,
      existsSync(absSource) ? absSource : undefined,
    ),
    source: absSource,
    installedAt: new Date().toISOString(),
    path: existsSync(absSource) ? absSource : undefined,
  });
  const reg = readRegistry();
  // Drop prior registry rows for this source *and* same package name (Temp debris).
  let next = dropRegistryPackagesBySource(reg.packages, entry.source);
  if (entry.name) {
    const nameKey = entry.name.toLowerCase();
    next = next.filter((p) => p.name.toLowerCase() !== nameKey);
  }
  next.push(entry);
  writeRegistry({ packages: next });
  reconcilePackageCatalog();
  invalidatePackageRootsCache();
  return {
    ok: true,
    package: entry,
    output: (preOutput + output).trim().slice(-400),
  };
}

/**
 * Uninstall via `pi uninstall <source>` then drop matching x-agent registry rows.
 * Registry-only orphans (not in settings.json) skip CLI and only clear the record.
 */
export async function uninstallPackage(source: string): Promise<{
  ok: boolean;
  error?: string;
  output?: string;
}> {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: "卸载源不能为空" };
  if (!isSafePackageSource(trimmed)) {
    return {
      ok: false,
      error:
        "卸载源不合法：仅支持 npm: / git+ / https: / ssh: 形式的包源，或本机存在的包目录路径。",
    };
  }

  const absSource = existsSync(trimmed) ? resolve(trimmed) : trimmed;
  const inPiSettings = readPiSettingsPackageSources().some(
    (s) =>
      normalizeSourceKey(s) === normalizeSourceKey(absSource) ||
      normalizeSourceKey(s) === normalizeSourceKey(trimmed),
  );
  const reg = readRegistry();
  const inRegistry = reg.packages.some(
    (p) =>
      normalizeSourceKey(p.source) === normalizeSourceKey(absSource) ||
      normalizeSourceKey(p.source) === normalizeSourceKey(trimmed),
  );

  if (!inPiSettings && !inRegistry) {
    return { ok: false, error: "未找到该包" };
  }

  let output = "";
  if (inPiSettings) {
    const cli = checkPiCli();
    if (!cli.ok || !cli.piPath) {
      return {
        ok: false,
        error:
          "需要全局 Pi CLI 才能卸载 Packages。请先在设置中安装 Pi CLI，或手动执行 pi uninstall。",
      };
    }
    // Prefer the exact settings entry string so pi can match it.
    const settingsSource =
      readPiSettingsPackageSources().find(
        (s) =>
          normalizeSourceKey(s) === normalizeSourceKey(absSource) ||
          normalizeSourceKey(s) === normalizeSourceKey(trimmed),
      ) ?? absSource;
    const result = await runPiPackageCommand(
      cli.piPath,
      ["uninstall", settingsSource, "--no-approve"],
      "uninstall",
    );
    output = result.output;
    if (result.code !== 0) {
      return {
        ok: false,
        error: `pi uninstall 失败（code=${result.code ?? "null"}）`,
        output: output.trim().slice(-800),
      };
    }
  }

  writeRegistry({
    packages: dropRegistryPackagesBySource(
      dropRegistryPackagesBySource(reg.packages, absSource),
      trimmed,
    ),
  });
  invalidatePackageRootsCache();
  return { ok: true, output: output.trim().slice(-400) || undefined };
}

// Re-export ensureGodotPiPackageInstalled from godot-pi module so callers
// (app-runtime) keep the same import path: "./package-manager".
export { ensureGodotPiPackageInstalled, installGodotPiPackage } from "./package-manager/godot-pi";
