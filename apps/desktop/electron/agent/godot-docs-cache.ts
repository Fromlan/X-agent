/**
 * Per-branch local cache of godotengine/godot-docs (user-imported zip).
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const GODOT_DOCS_REPO_URL =
  "https://github.com/godotengine/godot-docs.git";

/**
 * Fallback when remote listing fails / offline.
 * Prefer `listRemoteDocsBranches()` for the full set from GitHub.
 */
export const GODOT_DOCS_PRESET_BRANCHES = [
  "stable",
  "master",
  "4.7",
  "4.6",
  "4.5",
  "4.4",
  "4.3",
  "3.6",
] as const;

export type GodotDocsBranchStatus =
  | "missing"
  | "ready"
  | "downloading"
  | "error";

export type GodotDocsStatus = {
  branch: string;
  root: string;
  status: GodotDocsBranchStatus;
  localBranches: string[];
  /** Docs-useful remote branches (stable / master / x.y). Empty until listed. */
  remoteBranches: string[];
  /** Browser URL for the GitHub source zip of the selected branch. */
  downloadUrl: string;
  error?: string;
  /** Site version segment for docs.godotengine.org (master → latest). */
  docsSiteVersion: string;
};

const BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

const inflight = new Map<string, Promise<{ ok: boolean; error?: string }>>();

let remoteBranchCache: { at: number; branches: string[] } | null = null;
const REMOTE_CACHE_MS = 30 * 60 * 1000;

export function normalizeGodotDocsBranch(raw: string | null | undefined): string {
  const branch = (raw ?? "stable").trim();
  if (!BRANCH_RE.test(branch)) return "stable";
  return branch;
}

/** Keep stable / master / version branches; drop classref/sync-* etc. */
export function isDocsUsefulBranch(name: string): boolean {
  if (!BRANCH_RE.test(name)) return false;
  if (name === "stable" || name === "master") return true;
  // Engine version lines: 4.7, 3.6, …
  return /^\d+\.\d+(\.\d+)?$/.test(name);
}

function parseVersionParts(name: string): number[] | null {
  const m = name.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

export function sortDocsBranches(branches: string[]): string[] {
  const uniq = [...new Set(branches.filter(isDocsUsefulBranch))];
  uniq.sort((a, b) => {
    if (a === "stable") return -1;
    if (b === "stable") return 1;
    if (a === "master") return -1;
    if (b === "master") return 1;
    const va = parseVersionParts(a);
    const vb = parseVersionParts(b);
    if (va && vb) {
      for (let i = 0; i < 3; i++) {
        if (va[i]! !== vb[i]!) return vb[i]! - va[i]!;
      }
      return 0;
    }
    if (va) return -1;
    if (vb) return 1;
    return a.localeCompare(b);
  });
  return uniq;
}

export function docsSiteVersionForBranch(branch: string): string {
  const b = normalizeGodotDocsBranch(branch);
  if (b === "master") return "latest";
  return b;
}

/** GitHub source zip URL for a docs branch (user downloads in browser). */
export function getDocsDownloadZipUrl(branch: string): string {
  const b = normalizeGodotDocsBranch(branch);
  return `https://github.com/godotengine/godot-docs/archive/refs/heads/${encodeURIComponent(b)}.zip`;
}

export function getGodotDocsCacheRoot(): string {
  const root = resolve(homedir(), ".pi", "agent", "x-agent", "godot-docs");
  mkdirSync(root, { recursive: true });
  return root;
}

export function getDocsRoot(branch: string): string {
  const b = normalizeGodotDocsBranch(branch);
  return join(getGodotDocsCacheRoot(), b);
}

/** Ready when docs content exists (git clone or zip extract). */
function isDocsCheckout(dir: string): boolean {
  return existsSync(join(dir, "index.rst"));
}

export function listLocalBranches(): string[] {
  const root = getGodotDocsCacheRoot();
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (name.startsWith("_tmp-")) continue;
    const full = join(root, name);
    try {
      if (statSync(full).isDirectory() && isDocsCheckout(full)) {
        out.push(name);
      }
    } catch {
      // skip
    }
  }
  return out.sort();
}

export function getDocsStatus(branch: string): GodotDocsStatus {
  const b = normalizeGodotDocsBranch(branch);
  const root = getDocsRoot(b);
  const downloading = inflight.has(b);
  let status: GodotDocsBranchStatus = "missing";
  if (downloading) status = "downloading";
  else if (isDocsCheckout(root)) status = "ready";
  return {
    branch: b,
    root,
    status,
    localBranches: listLocalBranches(),
    remoteBranches: remoteBranchCache?.branches ?? [],
    downloadUrl: getDocsDownloadZipUrl(b),
    docsSiteVersion: docsSiteVersionForBranch(b),
  };
}

/**
 * List docs-useful remote branches.
 * Prefer GitHub API (works without git on PATH); fall back to `git ls-remote`.
 * Filters out internal branches (e.g. classref/sync-*).
 */
export async function listRemoteDocsBranches(options?: {
  force?: boolean;
}): Promise<{ ok: boolean; branches: string[]; error?: string }> {
  const force = options?.force === true;
  if (
    !force &&
    remoteBranchCache &&
    Date.now() - remoteBranchCache.at < REMOTE_CACHE_MS
  ) {
    return { ok: true, branches: remoteBranchCache.branches };
  }

  const api = await listBranchesViaGithubApi();
  if (api.ok && api.names.length > 0) {
    const branches = sortDocsBranches(api.names);
    remoteBranchCache = { at: Date.now(), branches };
    return { ok: true, branches };
  }

  const git = await listBranchesViaGitLsRemote();
  if (git.ok && git.names.length > 0) {
    const branches = sortDocsBranches(git.names);
    remoteBranchCache = { at: Date.now(), branches };
    return { ok: true, branches };
  }

  const fallback = sortDocsBranches([...GODOT_DOCS_PRESET_BRANCHES]);
  // On failure always refresh fallback cache so force-refresh picks up newer presets.
  remoteBranchCache = { at: Date.now(), branches: fallback };
  const error =
    [api.error, git.error].filter(Boolean).join("；") ||
    "无法列出远程分支（将使用本地预设）";
  return {
    ok: false,
    branches: fallback,
    error,
  };
}

async function listBranchesViaGithubApi(): Promise<{
  ok: boolean;
  names: string[];
  error?: string;
}> {
  const names: string[] = [];
  try {
    // GitHub returns up to 100 per page; repo has ~28 branches so one page is enough,
    // but paginate in case the list grows.
    for (let page = 1; page <= 5; page++) {
      const url =
        `https://api.github.com/repos/godotengine/godot-docs/branches?per_page=100&page=${page}`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "x-agent-desktop",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200);
        return {
          ok: false,
          names,
          error: `GitHub API ${res.status}: ${body || res.statusText}`,
        };
      }
      const data = (await res.json()) as Array<{ name?: string }>;
      if (!Array.isArray(data) || data.length === 0) break;
      for (const item of data) {
        if (item?.name) names.push(item.name);
      }
      if (data.length < 100) break;
    }
    if (names.length === 0) {
      return { ok: false, names, error: "GitHub API 返回空分支列表" };
    }
    return { ok: true, names };
  } catch (err) {
    return {
      ok: false,
      names,
      error: `GitHub API: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function listBranchesViaGitLsRemote(): Promise<{
  ok: boolean;
  names: string[];
  error?: string;
}> {
  const result = await runGit(["ls-remote", "--heads", GODOT_DOCS_REPO_URL]);
  if (result.code !== 0) {
    return {
      ok: false,
      names: [],
      error: (result.stderr || result.stdout || "git ls-remote failed")
        .trim()
        .slice(0, 400),
    };
  }
  const names: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    // git may separate with tab or spaces
    const m = line.match(/\s+refs\/heads\/(\S+)\s*$/);
    if (m?.[1]) {
      names.push(m[1]);
      continue;
    }
    const tab = line.indexOf("\t");
    const ref = tab >= 0 ? line.slice(tab + 1).trim() : "";
    if (ref.startsWith("refs/heads/")) {
      names.push(ref.slice("refs/heads/".length));
    }
  }
  return names.length
    ? { ok: true, names }
    : { ok: false, names, error: "git ls-remote 未解析到分支" };
}

function resolveGitExecutable(): string {
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Git\\cmd\\git.exe",
          "C:\\Program Files\\Git\\bin\\git.exe",
          "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
          "C:\\Program Files (x86)\\Git\\bin\\git.exe",
        ]
      : [];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "git";
}

const gitExecutable = resolveGitExecutable();

function runGit(
  args: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(gitExecutable, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      resolvePromise({
        code: 1,
        stdout,
        stderr: err.message || String(err),
      });
    });
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

function safeRm(path: string): void {
  try {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function runTarExtract(
  zipPath: string,
  outDir: string,
): Promise<{ ok: boolean; error?: string }> {
  mkdirSync(outDir, { recursive: true });
  const result = await new Promise<{ code: number; stderr: string }>(
    (resolvePromise) => {
      const child = spawn("tar", ["-xf", zipPath, "-C", outDir], {
        windowsHide: true,
      });
      let stderr = "";
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString("utf8");
      });
      child.on("error", (err) => {
        resolvePromise({ code: 1, stderr: err.message || String(err) });
      });
      child.on("close", (code) => {
        resolvePromise({ code: code ?? 1, stderr });
      });
    },
  );
  if (result.code !== 0) {
    return {
      ok: false,
      error: (result.stderr || "tar extract failed").trim().slice(0, 400),
    };
  }
  return { ok: true };
}

/** Import a user-downloaded godot-docs zip into the local cache for `branch`. */
export async function importDocsZip(
  zipPath: string,
  branch: string,
): Promise<{ ok: boolean; root?: string; error?: string }> {
  const b = normalizeGodotDocsBranch(branch);
  if (!zipPath || !existsSync(zipPath)) {
    return { ok: false, error: "zip 文件不存在" };
  }
  if (!/\.zip$/i.test(zipPath)) {
    return { ok: false, error: "请选择 .zip 文件（GitHub 源码归档）" };
  }

  const dest = getDocsRoot(b);
  const cacheRoot = getGodotDocsCacheRoot();
  const extractDir = join(cacheRoot, `_tmp-import-${b}-${Date.now()}`);
  safeRm(extractDir);

  const existing = inflight.get(b);
  if (existing) {
    const res = await existing;
    return res.ok ? { ok: true, root: dest } : { ok: false, error: res.error };
  }

  const job = (async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const extracted = await runTarExtract(zipPath, extractDir);
      if (!extracted.ok) return extracted;

      const findCheckout = (dir: string, depth: number): string | null => {
        if (depth < 0) return null;
        if (isDocsCheckout(dir)) return dir;
        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          return null;
        }
        for (const name of entries) {
          if (name === "__MACOSX") continue;
          const full = join(dir, name);
          try {
            if (!statSync(full).isDirectory()) continue;
          } catch {
            continue;
          }
          const hit = findCheckout(full, depth - 1);
          if (hit) return hit;
        }
        return null;
      };

      const inner = findCheckout(extractDir, 3);
      if (!inner) {
        return {
          ok: false,
          error:
            "zip 内未找到 index.rst。请下载 GitHub 源码归档（含 .rst），不是 HTML offline 包。",
        };
      }

      safeRm(dest);
      mkdirSync(cacheRoot, { recursive: true });
      // Prefer rename; fall back to copy via rename of parent move
      let crossDeviceMoved = false;
      try {
        renameSync(inner, dest);
      } catch {
        // Cross-device: move by renaming extract parent content
        mkdirSync(dest, { recursive: true });
        const moved: string[] = [];
        const skipped: string[] = [];
        for (const name of readdirSync(inner)) {
          try {
            renameSync(join(inner, name), join(dest, name));
            moved.push(name);
          } catch (renameErr) {
            const message =
              renameErr instanceof Error
                ? renameErr.message
                : String(renameErr);
            console.warn(
              `[godot-docs] rename ${join(inner, name)} → ${join(dest, name)} 失败：${message}`,
            );
            skipped.push(name);
          }
        }
        if (skipped.length > 0) {
          console.warn(
            `[godot-docs] 跨设备复制跳过 ${skipped.length} 项：${skipped.join(", ")}`,
          );
        }
        crossDeviceMoved = true;
      }
      void crossDeviceMoved; // 当前签名未透出,保留供后续扩展

      writeFileSync(
        join(dest, ".x-agent-docs-meta.json"),
        JSON.stringify(
          {
            branch: b,
            source: "user-zip-import",
            zipPath,
            importedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );

      if (!isDocsCheckout(dest)) {
        safeRm(dest);
        return { ok: false, error: "导入后缺少 index.rst" };
      }
      return { ok: true };
    } catch (err) {
      safeRm(dest);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      safeRm(extractDir);
    }
  })().finally(() => {
    inflight.delete(b);
  });

  inflight.set(b, job);
  const res = await job;
  return res.ok ? { ok: true, root: dest } : { ok: false, error: res.error };
}

/** Remove a locally imported docs branch. */
export function removeDocsBranch(branch: string): { ok: boolean; error?: string } {
  const b = normalizeGodotDocsBranch(branch);
  const root = getDocsRoot(b);
  try {
    safeRm(root);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Map a relative .rst path to the online docs URL. */
export function docsUrlForRst(branch: string, relPath: string): string {
  const version = docsSiteVersionForBranch(branch);
  let path = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  while (path.startsWith("./")) path = path.slice(2);
  if (path.endsWith(".rst")) path = path.slice(0, -4);
  if (path.endsWith("/index")) path = path.slice(0, -"/index".length);
  if (path === "index" || path === "") {
    return `https://docs.godotengine.org/en/${version}/`;
  }
  return `https://docs.godotengine.org/en/${version}/${path}.html`;
}
