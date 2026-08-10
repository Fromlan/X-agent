/**
 * App-managed Pi package installs (via `pi install`) + Godot Pi one-click path.
 * List view prefers Pi `settings.json` packages (same as `pi list`).
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
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type {
  InstalledPackageInfo,
  PackageInstallResult,
} from "../../shared/ipc";
import { getAgentDirPath } from "./prefs";
import { checkPiCli, spawnCli } from "./pi-cli";
import { mutatePiSettingsSync } from "./pi-settings";

const requireElectron = createRequire(import.meta.url);

function tryElectronPaths(): { resourcesPath?: string; appPath?: string } {
  try {
    const electron = requireElectron("electron") as {
      app?: { isReady?: () => boolean; getAppPath: () => string; getPath?: (name: string) => string };
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

type RegistryFile = {
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

function settingsPath(): string {
  return join(getAgentDirPath(), "settings.json");
}

function normalizeSourceKey(source: string): string {
  try {
    if (existsSync(source)) return resolve(source).replace(/\\/g, "/").toLowerCase();
  } catch {
    // fall through
  }
  return source.replace(/\\/g, "/").toLowerCase();
}

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

function readRegistry(): RegistryFile {
  const path = registryPath();
  if (!existsSync(path)) return { packages: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RegistryFile;
    return {
      packages: Array.isArray(raw.packages) ? raw.packages : [],
    };
  } catch {
    return { packages: [] };
  }
}

function writeRegistry(data: RegistryFile): void {
  mkdirSync(getAgentDirPath(), { recursive: true });
  // 1.3 防御：registry 在 install / uninstall / prune 都会被并发改写，
  // 同步入口下用自旋锁避免 read-modify-write 跨 IPC 边界被打散。
  withSyncLock("registry", () => {
    writeFileSync(registryPath(), JSON.stringify(data, null, 2), "utf8");
  });
}

/** 进程内同步 per-key 自旋锁：避免 read-modify-write 链被并发入口打散。 */
const syncLocks = new Map<string, boolean>();
function withSyncLock(key: string, fn: () => void): void {
  // Node 单线程内：同步 handler 不会在写盘中途被中断;但 install / uninstall
  // 跨 IPC handler 边界并发时,第二个入口可读到第一个未写完的旧 registry。
  // 极端情况下 install 误删用户刚装好的包。这里加 100ms 上限自旋,等到锁释放。
  // 真实场景锁持有 < 5ms,不会真正 spin 到上限。
  const start = Date.now();
  while (syncLocks.get(key)) {
    if (Date.now() - start > 100) {
      break;
    }
  }
  syncLocks.set(key, true);
  try {
    fn();
  } finally {
    syncLocks.set(key, false);
  }
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

/** True when `source` resolves to a directory with package.json. */
export function isResolvablePackageSource(source: string): boolean {
  try {
    const abs = resolve(source);
    return existsSync(join(abs, "package.json"));
  } catch {
    return false;
  }
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

/** Resolve package.json `name` for a settings/source entry, or null. */
export function packageNameForSource(source: string): string | null {
  try {
    const abs = resolve(source);
    if (!existsSync(join(abs, "package.json"))) return null;
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

function enrichPackageCounts(
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
    try {
      const abs = resolve(candidate);
      if (existsSync(join(abs, "package.json"))) return abs;
    } catch {
      // continue
    }
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
  try {
    if (existsSync(source)) score += 20;
  } catch {
    // ignore
  }
  return score;
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
    const abs = existsSync(source) ? resolve(source) : source;
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

function runPiPackageCommand(
  piPath: string,
  args: string[],
  timeoutLabel: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>;
    try {
      // pi install has no --ignore-scripts; force npm to skip lifecycle scripts
      // for npm:/git sources that resolve via the package manager.
      child = spawnCli(piPath, args, {
        env: {
          ...process.env,
          npm_config_ignore_scripts: "true",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolvePromise({ code: 1, output: message });
      return;
    }
    let output = "";
    const append = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > 40_000) output = output.slice(-30_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      // unref 避免子进程阻塞 Node 事件循环；同时等待 'exit' 防止残留。
      try {
        child.unref();
      } catch {
        // ignore
      }
      // 不阻塞主流程，但触发一次等待以让日志完整。
      void Promise.race([
        new Promise<void>((res) => child.once("exit", () => res())),
        new Promise<void>((res) => setTimeout(res, 1500)),
      ]).finally(() => {
        resolvePromise({
          code: null,
          output: `${output}\n${timeoutLabel} timeout`,
        });
      });
    }, 5 * 60 * 1000);
    child.on("error", (err) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolvePromise({ code: 1, output: `${output}\n${err.message}` });
    });
    child.on("close", (code) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolvePromise({ code, output });
    });
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

function packageNameFromSource(source: string, fallbackPath?: string): string {
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
      error: "未找到 packages/godot-pi。开发模式请在仓库根目录运行；打包版需包含 godot-pi 资源。",
    };
  }
  return installPackage(path);
}

/**
 * Whether a readable @x-agent/godot-pi is already listed in Pi settings
 * (any live path — not necessarily the current bundle resolve).
 */
export function isGodotPiPackageInstalled(): boolean {
  return findLivePackageSourcesByName(GODOT_PI_PACKAGE_NAME).length > 0;
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
  // installPackage uninstalls other same-name paths, then installs `path`.
  const result = await installGodotPiPackage();
  return {
    attempted: true,
    installed: result.ok,
    ...(result.ok ? {} : { error: result.error ?? "内置 Package 安装失败" }),
    result,
  };
}
