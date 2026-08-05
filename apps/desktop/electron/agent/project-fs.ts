import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import {
  basename,
  join,
} from "node:path";
import { resolveInsideCwd } from "./cwd-sandbox";

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".godot",
  ".svn",
  ".hg",
  "dist",
  "out",
  "release",
  "__pycache__",
  ".next",
  ".turbo",
]);

const MAX_FILE_BYTES = 1024 * 1024;

export type ProjectDirEntry = {
  name: string;
  isDir: boolean;
};

export type ListProjectDirResult = {
  ok: boolean;
  entries?: ProjectDirEntry[];
  error?: string;
};

export type ReadProjectFileResult = {
  ok: boolean;
  path?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
};

export type RevealProjectPathResult = {
  ok: boolean;
  path?: string;
  error?: string;
};

export function listProjectDir(
  cwd: string,
  relPath = "",
): ListProjectDirResult {
  const resolved = resolveInsideCwd(cwd, relPath);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  try {
    const st = statSync(resolved.abs);
    if (!st.isDirectory()) {
      return { ok: false, error: "不是目录" };
    }
    const names = readdirSync(resolved.abs);
    const entries: ProjectDirEntry[] = [];
    for (const name of names) {
      if (name === "." || name === "..") continue;
      if (IGNORED_DIR_NAMES.has(name)) continue;
      const childAbs = join(resolved.abs, name);
      let isDir = false;
      try {
        isDir = statSync(childAbs).isDirectory();
      } catch {
        continue;
      }
      entries.push({ name, isDir });
    }
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return { ok: true, entries };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  if (sample.includes(0)) return true;
  let weird = 0;
  for (const b of sample) {
    if (b < 7 || (b > 14 && b < 32 && b !== 9 && b !== 10 && b !== 13)) {
      weird += 1;
    }
  }
  return weird / Math.max(sample.length, 1) > 0.3;
}

export function readProjectFile(
  cwd: string,
  relPath: string,
): ReadProjectFileResult {
  const resolved = resolveInsideCwd(cwd, relPath);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  if (!resolved.rel) {
    return { ok: false, error: "请选择文件" };
  }
  try {
    const st = statSync(resolved.abs);
    if (!st.isFile()) {
      return { ok: false, error: "不是文件" };
    }
    if (st.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `文件过大（>${MAX_FILE_BYTES} 字节），无法预览`,
      };
    }
    const buf = readFileSync(resolved.abs);
    if (looksBinary(buf)) {
      return { ok: false, error: "二进制文件，无法以文本预览" };
    }
    return {
      ok: true,
      path: resolved.rel,
      content: buf.toString("utf8"),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Resolve + validate a reveal target inside cwd. Callers (main process) are
 * responsible for actually invoking `shell.showItemInFolder` — kept out of
 * this module so it stays importable/testable outside Electron.
 */
export function revealProjectPath(
  cwd: string,
  relPath: string,
): RevealProjectPathResult {
  const resolved = resolveInsideCwd(cwd, relPath);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  try {
    if (!existsSync(resolved.abs)) {
      return { ok: false, error: "路径不存在" };
    }
    return { ok: true, path: resolved.abs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function pathBasename(relPath: string): string {
  return basename(relPath.replace(/\\/g, "/"));
}
