/**
 * App-managed Pi package installs (via `pi install`) + Godot Pi one-click path.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";
import { getAgentDirPath } from "./prefs";
import { checkPiCli } from "./pi-cli";

export interface InstalledPackageInfo {
  name: string;
  source: string;
  installedAt: string;
  path?: string;
}

export interface PackageInstallResult {
  ok: boolean;
  error?: string;
  package?: InstalledPackageInfo;
  output?: string;
}

type RegistryFile = {
  packages: InstalledPackageInfo[];
};

function registryPath(): string {
  return join(getAgentDirPath(), "x-agent-packages.json");
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

export function listInstalledPackages(): InstalledPackageInfo[] {
  return readRegistry().packages.sort((a, b) =>
    a.installedAt.localeCompare(b.installedAt),
  );
}

function runPiInstall(
  piPath: string,
  source: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(piPath, ["install", source], {
      windowsHide: true,
      env: process.env,
    });
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
  const entry: InstalledPackageInfo = {
    name: packageNameFromSource(
      absSource,
      existsSync(absSource) ? absSource : undefined,
    ),
    source: absSource,
    installedAt: new Date().toISOString(),
    path: existsSync(absSource) ? absSource : undefined,
  };
  const reg = readRegistry();
  reg.packages = reg.packages.filter((p) => p.name !== entry.name);
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
  try {
    // Packaged: resources/godot-pi
    candidates.push(join(process.resourcesPath, "godot-pi"));
  } catch {
    // ignore
  }
  try {
    const appPath = app.getAppPath();
    candidates.push(join(appPath, "..", "..", "packages", "godot-pi"));
    candidates.push(join(appPath, "packages", "godot-pi"));
  } catch {
    // ignore
  }
  // Dev from apps/desktop
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
