/** Discover local Godot 4 editors without a disk-wide scan or requiring an engine path to attach. */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ClientPrefs } from "../../shared/ipc";
import { normalizeProjectKey } from "../../shared/project-path";

const execFileAsync = promisify(execFile);

export interface RunningGodotEditor {
  pid: number;
  executablePath: string;
  projectPath?: string;
}

export interface GodotEngine {
  path: string;
  version: string;
}

export interface GodotEngineDiscovery {
  engine?: GodotEngine;
  candidates: GodotEngine[];
  message?: string;
}

/** Extract only absolute project paths from Windows process arguments; unknown paths stay unknown. */
export function godotProjectFromCommandLine(commandLine: string): string | undefined {
  const args = Array.from(commandLine.matchAll(/"([^"]*)"|([^\s"]+)/g), (match) => match[1] ?? match[2] ?? "");
  const projectFile = args.find((arg) => /(?:^|[\\/])project\.godot$/i.test(arg));
  if (projectFile && isAbsolute(projectFile)) return dirname(projectFile);
  if (!args.some((arg) => arg === "--editor" || arg === "-e")) return undefined;
  const index = args.findIndex((arg) => arg === "--path");
  const path = index >= 0 ? args[index + 1] : undefined;
  return path && isAbsolute(path) ? resolve(path) : undefined;
}

/** Query visible Godot editor processes; unavailable process details fall back to filesystem discovery. */
export async function listRunningGodotEditors(signal?: AbortSignal): Promise<RunningGodotEditor[]> {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Get-CimInstance Win32_Process -Filter \"Name LIKE 'Godot%.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"],
    { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 512 * 1024, signal });
    if (!stdout.trim()) return [];
    const parsed: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ""));
    const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const item = row as Record<string, unknown>;
      if (typeof item.ExecutablePath !== "string" || typeof item.CommandLine !== "string" || typeof item.ProcessId !== "number") return [];
      const projectPath = godotProjectFromCommandLine(item.CommandLine);
      if (!projectPath && !/(?:^|\s)(?:--editor|-e)(?:\s|$)/.test(item.CommandLine)) return [];
      return [{ pid: item.ProcessId, executablePath: item.ExecutablePath, projectPath }];
    });
  } catch {
    return [];
  }
}

/** Probe a candidate directly with bounded output and timeout, accepting only Godot 4 binaries. */
export async function probeGodotEngine(path: string, signal?: AbortSignal): Promise<GodotEngine | undefined> {
  try {
    if (!isAbsolute(path) || !statSync(path).isFile()) return undefined;
    const { stdout } = await execFileAsync(path, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 3000, maxBuffer: 16 * 1024, signal });
    const version = stdout.trim();
    return /^4\.\d+(?:\.\d+)?\.[a-zA-Z]/.test(version) ? { path: resolve(path), version } : undefined;
  } catch {
    return undefined;
  }
}

/** List a bounded set of editor executables from a known install directory. */
function editorsInDirectory(directory: string, nested = false): string[] {
  try {
    const entries = readdirSync(directory, { withFileTypes: true }).slice(0, 100);
    const direct = entries.filter((entry) => entry.isFile() && /^godot.*\.exe$/i.test(entry.name))
      .map((entry) => join(directory, entry.name));
    const files = direct.filter((path) => !/_console\.exe$/i.test(path) || !existsSync(path.replace(/_console\.exe$/i, ".exe")));
    if (!nested) return files;
    return [...files, ...entries.filter((entry) => entry.isDirectory() && /godot|current|^4\./i.test(entry.name)).slice(0, 12)
      .flatMap((entry) => editorsInDirectory(join(directory, entry.name)))];
  } catch {
    return [];
  }
}

/** Search PATH and common Windows package locations only; never scan arbitrary project executables. */
export function localGodotCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];
  if (env.GODOT_BIN) candidates.push(env.GODOT_BIN);
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean).slice(0, 80)) {
    for (const name of process.platform === "win32" ? ["godot.exe", "godot4.exe", "godot-mono.exe"] : ["godot", "godot4", "godot-mono"]) {
      const path = join(directory.replace(/^"|"$/g, ""), name);
      if (existsSync(path)) candidates.push(path);
    }
  }
  const home = env.USERPROFILE;
  const dirs = [
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Godot"),
    env.ProgramFiles && join(env.ProgramFiles, "Godot"),
    env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"]!, "Steam", "steamapps", "common", "Godot Engine"),
    (env.SCOOP ?? (home && join(home, "scoop"))) && join(env.SCOOP ?? join(home!, "scoop"), "apps", "godot", "current"),
    (env.SCOOP ?? (home && join(home, "scoop"))) && join(env.SCOOP ?? join(home!, "scoop"), "apps", "godot-mono", "current"),
  ];
  for (const directory of dirs) if (directory) candidates.push(...editorsInDirectory(directory, true));
  return [...new Map(candidates.map((path) => [normalizeProjectKey(path), path])).values()].slice(0, 32);
}

/** Resolve explicit choices first, then select only an unambiguous engine compatible with project features. */
export async function discoverGodotEngine(
  projectPath: string,
  prefs: ClientPrefs,
  running: RunningGodotEditor[],
  options: { candidates?: string[]; probe?: typeof probeGodotEngine; signal?: AbortSignal } = {},
): Promise<GodotEngineDiscovery> {
  const project = readFileSync(join(projectPath, "project.godot"), "utf8");
  const needsDotnet = /config\/features\s*=.*"C#"/.test(project);
  const projectVersion = project.match(/config\/features\s*=.*?"(4\.\d+)"/)?.[1];
  const key = normalizeProjectKey(projectPath);
  const probe = options.probe ?? probeGodotEngine;
  const seen = new Set<string>();
  const compatible = (engine: GodotEngine): boolean => !needsDotnet || /mono|dotnet/i.test(engine.version);
  const explicit = [prefs.godotProjectEditors[key],
    ...running.filter((editor) => editor.projectPath && normalizeProjectKey(editor.projectPath) === key).map((editor) => editor.executablePath)];
  for (const path of explicit) {
    options.signal?.throwIfAborted();
    if (!path || seen.has(normalizeProjectKey(path))) continue;
    seen.add(normalizeProjectKey(path));
    const engine = await probe(path, options.signal);
    if (engine && compatible(engine)) return { engine, candidates: [engine] };
    if (path === prefs.godotProjectEditors[key]) return {
      candidates: [], message: engine ? "当前项目选择的引擎不支持 C#，请选择 Godot 4 .NET 引擎。" : "当前项目选择的引擎不可用，请重新选择引擎配置。",
    };
  }
  const candidates: GodotEngine[] = [];
  const global = prefs.godotEditorPath;
  if (global && !seen.has(normalizeProjectKey(global))) {
    options.signal?.throwIfAborted();
    seen.add(normalizeProjectKey(global));
    const engine = await probe(global, options.signal);
    if (engine && compatible(engine)) {
      // A global preference is not permission to open every project with a different minor version.
      if (!projectVersion || engine.version.startsWith(`${projectVersion}.`)) return { engine, candidates: [engine] };
      candidates.push(engine);
    }
  }
  const deadline = Date.now() + 15_000;
  for (const path of [...prefs.godotEngines.map((engine) => engine.path), ...(options.candidates ?? localGodotCandidates())]) {
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) break;
    if (seen.has(normalizeProjectKey(path))) continue;
    seen.add(normalizeProjectKey(path));
    const engine = await probe(path, options.signal);
    if (engine && compatible(engine)) candidates.push(engine);
  }
  const preferred = projectVersion ? candidates.filter((engine) => engine.version.startsWith(`${projectVersion}.`)) : candidates;
  if (preferred.length === 1) return { engine: preferred[0], candidates };
  return {
    candidates,
    message: candidates.length ? "检测到多个版本或项目版本不匹配，请为当前项目选择 Godot 引擎。" : needsDotnet
      ? "未找到可用的 Godot 4 .NET 引擎，请选择一次引擎路径。" : "未找到 Godot 4 引擎，请选择一次引擎路径。",
  };
}
