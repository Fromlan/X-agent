/** Resolve existing ancestors so junctions cannot cross an authorized filesystem root. */
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Compare complete path segments, respecting Windows case-insensitive paths. */
export function isLexicallyInside(root: string, target: string): boolean {
  const canonical = (p: string) => process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);
  const rel = relative(canonical(root), canonical(target));
  return !isAbsolute(rel) && rel.split(sep)[0] !== "..";
}

/** Resolve future files using the nearest existing ancestor; fail closed on broken links and I/O errors. */
export function physicalPath(path: string): string {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  for (;;) {
    try {
      lstatSync(ancestor);
      return join(realpathSync.native(ancestor), ...suffix.reverse());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      try { if (lstatSync(ancestor).isSymbolicLink()) throw new Error("Broken filesystem link"); }
      catch (probe) { if ((probe as NodeJS.ErrnoException).code !== "ENOENT") throw probe; }
      const parent = dirname(ancestor);
      if (parent === ancestor) throw err;
      suffix.push(basename(ancestor));
      ancestor = parent;
    }
  }
}

/** Require supplied paths and real targets to remain inside the same authorized root. */
export function isPhysicallyInside(root: string, target: string): boolean {
  if (!isLexicallyInside(root, target)) return false;
  try { return isLexicallyInside(physicalPath(root), physicalPath(target)); }
  catch { return false; }
}
