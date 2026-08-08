import { existsSync } from "node:fs";
import {
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";

/** Resolve a project-relative or cwd-absolute path; reject escapes outside cwd. */
export function resolveInsideCwd(
  cwd: string,
  relPath: string,
): { ok: true; abs: string; rel: string } | { ok: false; error: string } {
  if (!cwd || !existsSync(cwd)) {
    return { ok: false, error: "未打开项目" };
  }
  // Allow absolute paths that still resolve inside cwd (Pi tools may pass abs).
  if (relPath && (isAbsolute(relPath) || /^[A-Za-z]:[\\/]/.test(relPath))) {
    const root = normalize(resolve(cwd));
    const abs = normalize(resolve(relPath));
    const relToRoot = relative(root, abs);
    // Reject real `..` escapes only (`..foo` is a legal sibling-named dir).
    if (relToRoot.split(sep)[0] === ".." || isAbsolute(relToRoot)) {
      return { ok: false, error: "路径超出项目目录" };
    }
    // Windows NTFS / ReFS 默认大小写不敏感 —— 大小写归一化后再做前缀比对。
    const rootLower = root.toLowerCase();
    const absLower = abs.toLowerCase();
    if (absLower !== rootLower && !absLower.startsWith(rootLower + sep)) {
      return { ok: false, error: "路径超出项目目录" };
    }
    const rel = abs === root ? "" : relToRoot.replace(/\\/g, "/");
    return { ok: true, abs, rel };
  }
  const raw = (relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (raw.includes("\0") || raw.split("/").includes("..")) {
    return { ok: false, error: "非法路径" };
  }
  const root = normalize(resolve(cwd));
  const abs = normalize(resolve(root, raw || "."));
  const relToRoot = relative(root, abs);
  if (relToRoot.split(sep)[0] === ".." || isAbsolute(relToRoot)) {
    return { ok: false, error: "路径超出项目目录" };
  }
  // Windows NTFS / ReFS 默认大小写不敏感 —— 大小写归一化后再做前缀比对。
  const rootLower = root.toLowerCase();
  const absLower = abs.toLowerCase();
  if (absLower !== rootLower && !absLower.startsWith(rootLower + sep)) {
    return { ok: false, error: "路径超出项目目录" };
  }
  const rel = abs === root ? "" : relToRoot.replace(/\\/g, "/");
  return { ok: true, abs, rel };
}