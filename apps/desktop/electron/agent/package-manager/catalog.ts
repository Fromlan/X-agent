/**
 * package-manager / catalog —— Pi package catalog 自愈 + registry I/O
 * (issue #68 主题 J C-106, 2026-08-31 收口).
 *
 * 唯一职责:
 * 1. 读 / 写 x-agent-packages.json (本地注册表), 用 lib/store Store 包装
 *    + withSyncStoreLock 替代原自旋锁 (C-106 验收点).
 * 2. Pi settings.json packages 列表的 prune / reconcile / dedup / 解析.
 * 3. 启动期 lazy catalog 自愈 (reconcilePackageCatalog).
 *
 * 不在这里: settings.json I/O (settings-io.ts), shell spawn (spawn.ts),
 * godot-pi 包装 (godot-pi.ts).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import type { InstalledPackageInfo } from "../../../shared/ipc";
import { getAgentDirPath } from "../prefs";
import { createStore } from "../lib/store";
import { withSyncStoreLock } from "../lib/store-mutex";
import {
  readPiSettingsPackageSources,
  writePiSettingsPackageSources,
} from "./settings-io";

// Re-export the settings helpers that this module's callers need
// (pruneMissingPiPackageSources, reconcilePackageCatalog, listInstalledPackages).
// The actual read/write functions live in settings-io.ts to keep that
// module's responsibility narrow.
export { readPiSettingsPackageSources, writePiSettingsPackageSources };

const requireElectron = createRequire(import.meta.url);

function tryElectronPaths(): { resourcesPath?: string; appPath?: string } {
  try {
    const electron = requireElectron("electron") as {
      app?: {
        isReady?: () => boolean;
        getAppPath: () => string;
        getPath?: (name: string) => string;
      };
    };
    const app = electron.app;
    if (!app) return {};
    return {
      resourcesPath:
        typeof process.resourcesPath === "string"
          ? process.resourcesPath
          : undefined,
      appPath: app.getAppPath(),
    };
  } catch {
    return {};
  }
}

export type RegistryFile = {
  packages: InstalledPackageInfo[];
};

type PiPackageManifest = {
  name?: string;
  pi?: {
    skills?: string[];
    prompts?: string[];
    extensions?: string[];
    themes?: string[];
  };
};

function registryPath(): string {
  return join(getAgentDirPath(), "x-agent-packages.json");
}

const REGISTRY_LOCK_KEY = "x-agent-packages-registry";

/**
 * registry Store. read 走 lib/store 同步缓存 (替代原 readRegistry 内联
 * readFileSync), mutate 走 lib/store-mutex async 锁. 同步路径
 * (writeRegistry 同步) 用 withSyncStoreLock + sync writeFileSync 走原
 * sync 接口, 不改 IPC 调用方.
 */
const registryStore = createStore<RegistryFile>({
  filePath: registryPath,
  defaults: { packages: [] },
});

/**
 * Resolve a package source to an absolute path containing package.json, or
 * null. pi CLI records local installs in settings.json `packages` as paths
 * relative to ~/.pi/agent (`normalizePackageSourceForSettings`), so relative
 * sources MUST be resolved against the agent dir, not process.cwd() — resolving
 * against cwd makes every pi-installed local package look "missing" and get
 * pruned. Absolute paths pass through; a cwd-relative attempt is kept only as
 * a legacy fallback for anything not written by pi.
 */
function resolvePackageSourcePath(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  const candidates: string[] = [];
  try {
    if (isAbsolute(trimmed)) {
      candidates.push(trimmed);
    } else {
      // pi CLI convention: relative sources are relative to ~/.pi/agent.
      candidates.push(resolve(join(getAgentDirPath(), trimmed)));
      // Legacy fallback: cwd-relative (pre-fix dev behavior).
      candidates.push(resolve(trimmed));
    }
  } catch {
    candidates.push(trimmed);
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(join(candidate, "package.json"))) return resolve(candidate);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function normalizeSourceKey(source: string): string {
  const abs = resolvePackageSourcePath(source);
  if (abs) return abs.replace(/\\/g, "/").toLowerCase();
  return source.replace(/\\/g, "/").toLowerCase();
}

/**
 * True when `source` resolves to a directory with package.json (agent dir
 * base for relative sources — see `resolvePackageSourcePath`).
 */
export function isResolvablePackageSource(source: string): boolean {
  return resolvePackageSourcePath(source) !== null;
}

/** Read the in-process registry. Uses lib/store cache. */
export function readRegistry(): RegistryFile {
  return registryStore.read();
}

/**
 * Write the registry synchronously under a per-file lock.
 *
 * 原 package-manager.ts 内联 `syncLocks` 自旋锁 (100ms timeout) 在 IPC
 * 边界并发 install / uninstall 时可能丢更新 (两个入口读到同一陈旧 base
 * 后写覆盖). 收敛到 lib/store-mutex 的 withSyncStoreLock 同步原语:
 * - Atomics.wait 真阻塞而非 busy-loop, 不会浪费 CPU.
 * - 5s timeout 兜底, 实际持有 < 5ms, 不会触发.
 * - 写完 prime 缓存, 后续 readRegistry 看到新值 (而不是陈旧磁盘镜像).
 */
export function writeRegistry(data: RegistryFile): void {
  withSyncStoreLock(REGISTRY_LOCK_KEY, () => {
    mkdirSync(getAgentDirPath(), { recursive: true });
    writeFileSync(registryPath(), JSON.stringify(data, null, 2), "utf8");
    // 同步刷新 Store 缓存, 避免后续 readRegistry 走兜底 readFileSync
    // 看到磁盘写之前的旧值.
    registryStore.prime(data);
  });
}

/** Resolve package.json `name` for a settings/source entry, or null. */
export function packageNameForSource(source: string): string | null {
  const abs = resolvePackageSourcePath(source);
  if (!abs) return null;
  try {
    const name = packageNameFromSource(abs, abs);
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Settings sources that resolve on disk and whose package.json name matches.
 */
export function findLivePackageSourcesByName(packageName: string): string[] {
  const target = packageName.trim().toLowerCase();
  if (!target) return [];
  return readPiSettingsPackageSources().filter((source) => {
    if (!isResolvablePackageSource(source)) return false;
    const name = packageNameForSource(source);
    return Boolean(name && name.toLowerCase() === target);
  });
}

export const GODOT_PI_PACKAGE_NAME = "@x-agent/godot-pi";

function readPackageManifest(root: string): PiPackageManifest | null {
  const pkgJson = join(root, "package.json");
  if (!existsSync(pkgJson)) return null;
  try {
    return JSON.parse(readFileSync(pkgJson, "utf8")) as PiPackageManifest;
  } catch {
    return null;
  }
}

function countSkills(dir: string): number {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return 0;
  let n = 0;
  for (const entry of readdirSync(dir)) {
    if (existsSync(join(dir, entry, "SKILL.md"))) n += 1;
  }
  return n;
}

function countPromptFiles(dir: string): number {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return 0;
  return readdirSync(dir).filter((e) => e.endsWith(".md")).length;
}

function countExtensions(dir: string): number {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return 0;
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isFile() && entry.endsWith(".ts")) n += 1;
    else if (st.isDirectory() && existsSync(join(full, "index.ts"))) n += 1;
  }
  return n;
}

export function enrichPackageCounts(
  entry: InstalledPackageInfo,
): InstalledPackageInfo {
  const root = resolvePackageRoot(entry);
  if (!root) return entry;
  const manifest = readPackageManifest(root);
  const skillsRel = manifest?.pi?.skills?.[0] ?? "./skills";
  const promptsRel = manifest?.pi?.prompts?.[0] ?? "./prompts";
  const extensionsRel = manifest?.pi?.extensions?.[0] ?? "./extensions";
  return {
    ...entry,
    path: root,
    skillCount: countSkills(resolve(root, skillsRel)),
    promptCount: countPromptFiles(resolve(root, promptsRel)),
    extensionCount: countExtensions(resolve(root, extensionsRel)),
  };
}

export function resolvePackageRoot(
  pkg: Pick<InstalledPackageInfo, "source" | "path">,
): string | null {
  for (const candidate of [pkg.path, pkg.source]) {
    if (!candidate) continue;
    const abs = resolvePackageSourcePath(candidate);
    if (abs) return abs;
  }
  return null;
}

/**
 * Short-TTL memo for installed package roots: Ask/Plan tool-call path checks
 * call `getInstalledPackageRoots` on every bash/read attempt, and the
 * underlying catalog read hits disk (settings.json + registry). A 5s TTL keeps
 * the hot path disk-free while staying fresh enough after install/uninstall.
 */
let packageRootsCache: { at: number; roots: string[] } | null = null;
const PACKAGE_ROOTS_CACHE_TTL_MS = 5_000;

/** Absolute roots of locally-resolvable installed packages (for plugin listing). */
export function getInstalledPackageRoots(): string[] {
  const now = Date.now();
  if (
    packageRootsCache &&
    now - packageRootsCache.at < PACKAGE_ROOTS_CACHE_TTL_MS
  ) {
    return packageRootsCache.roots;
  }
  const roots: string[] = [];
  for (const pkg of listInstalledPackages()) {
    const root = resolvePackageRoot(pkg);
    if (root) roots.push(root);
  }
  packageRootsCache = { at: now, roots };
  return roots;
}

/** Drop the root memo after install/uninstall so the next read sees the change. */
export function invalidatePackageRootsCache(): void {
  packageRootsCache = null;
}

/** Electron / OS temp extract paths — common debris from one-click install. */
function looksLikeEphemeralPackagePath(source: string): boolean {
  const n = source.replace(/\\/g, "/").toLowerCase();
  return (
    n.includes("/temp/") ||
    n.includes("/tmp/") ||
    n.includes("/appdata/local/temp/")
  );
}

/** Higher score = prefer keeping this source when deduping by package name. */
function packageSourcePreferScore(source: string): number {
  let score = 0;
  if (/^(npm:|git\+|https?:|ssh:)/i.test(source.trim())) return 100;
  if (!looksLikeEphemeralPackagePath(source)) score += 50;
  if (resolvePackageSourcePath(source)) score += 20;
  return score;
}

/**
 * Drop settings + registry entries whose local path no longer exists.
 * Non-path sources (e.g. npm:) are kept.
 */
export function pruneMissingPiPackageSources(): {
  removed: string[];
  kept: string[];
} {
  const before = readPiSettingsPackageSources();
  const kept: string[] = [];
  const removed: string[] = [];
  for (const source of before) {
    // npm:/git: style specs are not filesystem paths — keep them.
    if (/^(npm:|git\+|https?:|ssh:)/i.test(source.trim())) {
      kept.push(source);
      continue;
    }
    if (isResolvablePackageSource(source)) {
      kept.push(source);
    } else {
      removed.push(source);
    }
  }
  if (removed.length > 0) {
    writePiSettingsPackageSources(kept);
    let reg = readRegistry();
    for (const source of removed) {
      reg = {
        packages: dropRegistryPackagesBySource(reg.packages, source),
      };
    }
    writeRegistry(reg);
  }
  return { removed, kept };
}

/**
 * Heal catalog for end users:
 * - drop missing filesystem sources
 * - Pi settings keeps at most one live path per package.json name
 * - x-agent registry only mirrors remaining settings entries (no orphan Temp rows)
 */
export function reconcilePackageCatalog(): {
  removedSettings: string[];
  removedRegistry: number;
} {
  const pruned = pruneMissingPiPackageSources();
  const sources = readPiSettingsPackageSources();
  const kept: string[] = [];
  const removedSettings: string[] = [...pruned.removed];
  const winnerByName = new Map<string, string>();

  for (const source of sources) {
    if (/^(npm:|git\+|https?:|ssh:)/i.test(source.trim())) {
      kept.push(source);
      continue;
    }
    const name = packageNameForSource(source)?.toLowerCase();
    if (!name) {
      kept.push(source);
      continue;
    }
    const prev = winnerByName.get(name);
    if (!prev) {
      winnerByName.set(name, source);
      continue;
    }
    const preferNew =
      packageSourcePreferScore(source) > packageSourcePreferScore(prev);
    if (preferNew) {
      removedSettings.push(prev);
      winnerByName.set(name, source);
    } else {
      removedSettings.push(source);
    }
  }
  for (const source of winnerByName.values()) {
    kept.push(source);
  }

  const beforeSettings = sources.map(normalizeSourceKey).sort().join("\0");
  const afterSettings = kept.map(normalizeSourceKey).sort().join("\0");
  if (beforeSettings !== afterSettings) {
    writePiSettingsPackageSources(kept);
  }

  const keepKeys = new Set(kept.map(normalizeSourceKey));
  const reg = readRegistry();
  const nextReg: InstalledPackageInfo[] = [];
  let removedRegistry = 0;
  for (const p of reg.packages) {
    const key = normalizeSourceKey(p.source);
    if (keepKeys.has(key)) {
      nextReg.push(p);
    } else {
      removedRegistry += 1;
    }
  }
  if (removedRegistry > 0 || nextReg.length !== reg.packages.length) {
    writeRegistry({ packages: nextReg });
  }

  return { removedSettings, removedRegistry };
}

/**
 * List packages from Pi settings (canonical, same as `pi list`).
 * Registry only supplies metadata; orphans are reconciled away.
 */
export function listInstalledPackages(): InstalledPackageInfo[] {
  reconcilePackageCatalog();
  const reg = readRegistry();
  const byKey = new Map(
    reg.packages.map((p) => [normalizeSourceKey(p.source), p] as const),
  );
  const fromPi = readPiSettingsPackageSources();
  const out: InstalledPackageInfo[] = [];

  for (const source of fromPi) {
    const key = normalizeSourceKey(source);
    const existing = byKey.get(key);
    const abs = resolvePackageSourcePath(source) ?? source;
    const base: InstalledPackageInfo = {
      name:
        existing?.name ??
        packageNameFromSource(abs, existsSync(abs) ? abs : undefined),
      source: abs,
      installedAt: existing?.installedAt ?? "",
      path: existsSync(abs) ? abs : existing?.path,
    };
    out.push(enrichPackageCounts(base));
  }

  return out.sort((a, b) => {
    const at = a.installedAt || "0";
    const bt = b.installedAt || "0";
    return bt.localeCompare(at);
  });
}

/** Drop registry entries whose source matches (for tests + uninstall). */
export function dropRegistryPackagesBySource(
  packages: InstalledPackageInfo[],
  source: string,
): InstalledPackageInfo[] {
  const key = normalizeSourceKey(source);
  return packages.filter((p) => normalizeSourceKey(p.source) !== key);
}

export function packageNameFromSource(source: string, fallbackPath?: string): string {
  if (fallbackPath && existsSync(join(fallbackPath, "package.json"))) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(fallbackPath, "package.json"), "utf8"),
      ) as { name?: string };
      if (pkg.name) return pkg.name;
    } catch {
      // fall through
    }
  }
  const base = source.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return base || source;
}

export { tryElectronPaths };
