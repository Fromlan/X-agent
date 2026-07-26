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
import { checkPiCli, spawnOptsForCli } from "./pi-cli";

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
  writeFileSync(registryPath(), JSON.stringify(data, null, 2), "utf8");
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

/** Absolute roots of locally-resolvable installed packages (for plugin listing). */
export function getInstalledPackageRoots(): string[] {
  const roots: string[] = [];
  for (const pkg of listInstalledPackages()) {
    const root = resolvePackageRoot(pkg);
    if (root) roots.push(root);
  }
  return roots;
}

/**
 * Merge Pi settings packages (canonical) with x-agent-packages.json metadata.
 */
export function listInstalledPackages(): InstalledPackageInfo[] {
  const reg = readRegistry();
  const byKey = new Map(
    reg.packages.map((p) => [normalizeSourceKey(p.source), p] as const),
  );
  const fromPi = readPiSettingsPackageSources();
  const out: InstalledPackageInfo[] = [];
  const seen = new Set<string>();

  for (const source of fromPi) {
    const key = normalizeSourceKey(source);
    seen.add(key);
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

  // Keep app-only records (installed before settings sync / manual registry).
  for (const p of reg.packages) {
    const key = normalizeSourceKey(p.source);
    if (seen.has(key)) continue;
    out.push(enrichPackageCounts(p));
  }

  return out.sort((a, b) => {
    const at = a.installedAt || "0";
    const bt = b.installedAt || "0";
    return bt.localeCompare(at);
  });
}

function runPiInstall(
  piPath: string,
  source: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(piPath, ["install", source], spawnOptsForCli(piPath));
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
    const timer = setTimeout(() => {
      child.kill();
      resolvePromise({ code: null, output: `${output}\ninstall timeout` });
    }, 5 * 60 * 1000);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ code: 1, output: `${output}\n${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, output });
    });
  });
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

export async function installPackage(source: string): Promise<PackageInstallResult> {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: "安装源不能为空" };
  const cli = checkPiCli();
  if (!cli.ok || !cli.piPath) {
    return {
      ok: false,
      error:
        "需要全局 Pi CLI 才能安装 Packages。请先在设置中安装 Pi CLI，或手动执行 pi install。",
    };
  }
  const absSource = existsSync(trimmed) ? resolve(trimmed) : trimmed;
  const { code, output } = await runPiInstall(cli.piPath, absSource);
  if (code !== 0) {
    return {
      ok: false,
      error: `pi install 失败（code=${code ?? "null"}）`,
      output: output.trim().slice(-800),
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
  reg.packages = reg.packages.filter(
    (p) => normalizeSourceKey(p.source) !== normalizeSourceKey(entry.source),
  );
  reg.packages.push(entry);
  writeRegistry(reg);
  return { ok: true, package: entry, output: output.trim().slice(-400) };
}

export function removePackageRecord(name: string): {
  ok: boolean;
  error?: string;
} {
  const reg = readRegistry();
  const next = reg.packages.filter((p) => p.name !== name);
  if (next.length === reg.packages.length) {
    return { ok: false, error: "未找到该包记录" };
  }
  writeRegistry({ packages: next });
  return { ok: true };
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
