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
    if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
      return { ok: false, error: "路径超出项目目录" };
    }
    if (abs !== root && !abs.startsWith(root + sep)) {
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
  if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
    return { ok: false, error: "路径超出项目目录" };
  }
  if (abs !== root && !abs.startsWith(root + sep)) {
    return { ok: false, error: "路径超出项目目录" };
  }
  const rel = abs === root ? "" : relToRoot.replace(/\\/g, "/");
  return { ok: true, abs, rel };
}
