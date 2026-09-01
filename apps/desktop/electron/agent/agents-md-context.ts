/**
 * Single-name `AGENT.md` / `agent.md` discovery for `DefaultResourceLoader`.
 *
 * Pi's `loadProjectContextFiles` hard-codes the candidate list to
 * `["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]` per directory. Many
 * small projects (and AI-tool conventions outside Claude Code) use the
 * singular `AGENT.md` / `agent.md` filename instead. This module lets
 * X-agent append those variants through the `agentsFilesOverride` hook
 * without forking Pi.
 *
 * Discovery rules (mirror Pi's walk semantics so order in the system prompt
 * matches user intuition):
 *
 *   1. Global `agentDir` (Pi's "base" tier; check first, push first).
 *   2. Ancestor walk from `cwd` up to filesystem root. Each hit is unshifted
 *      so the directory closest to `cwd` ends up earlier in the result.
 *   3. Within a single directory, candidates are tried in `SINGLE_CANDIDATES`
 *      order and the first existing file wins. Pi's default tier
 *      (AGENTS.md / CLAUDE.md) is NOT re-checked here — those are owned by
 *      the caller, which merges them in `base.agentsFiles`.
 *
 * De-duplication: paths are compared case-insensitively on Windows. The
 * `augmentAgentsFiles` merger skips any extra file whose path collides with
 * an entry already in `base.agentsFiles`, so a same-directory `AGENTS.md`
 * (Pi-discovered) and `AGENT.md` (we discover) do not double-inject.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type AgentsFile = { path: string; content: string };
export type AgentsFilesPayload = { agentsFiles: AgentsFile[] };

/**
 * Single-name candidates, evaluated in order. `AGENT.md` (proper case) is
 * preferred over `agent.md` to match the all-caps style of `AGENTS.md` /
 * `CLAUDE.md` that Pi already loads.
 *
 * To extend with more variants later (e.g. `AGENT.markdown`), prepend to
 * this list. Keep it short — the candidate loop runs once per directory.
 */
export const SINGLE_CANDIDATES: readonly string[] = [
  "AGENT.md",
  "AGENT.MD",
  "agent.md",
  "agent.MD",
] as const;

/** Case-insensitive key for cross-platform path de-duplication. */
function pathKey(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

/**
 * Read the first existing candidate in `SINGLE_CANDIDATES` from `dir`.
 * Returns `null` when none exist OR when read fails (unreadable file is
 * treated as missing so the loader does not crash).
 */
function readAgentsFileFromDir(dir: string): AgentsFile | null {
  for (const name of SINGLE_CANDIDATES) {
    const filePath = join(dir, name);
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, "utf8");
      return { path: resolve(filePath), content };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Walk `cwd` → filesystem root, then prepend the global `agentDir` hit.
 * Returns the discovered files in Pi's natural order: global first, then
 * closest-to-cwd ancestors before farther ones.
 */
export function loadAgentsMdFiles(
  cwd: string,
  agentDir: string,
): AgentsFile[] {
  const out: AgentsFile[] = [];
  const seen = new Set<string>();

  // 1. global agentDir (Pi's "base" tier)
  const resolvedAgentDir = resolve(agentDir);
  const globalHit = readAgentsFileFromDir(resolvedAgentDir);
  if (globalHit) {
    out.push(globalHit);
    seen.add(pathKey(globalHit.path));
  }

  // 2. ancestors from cwd up to filesystem root (unshift so closest first)
  const ancestorHits: AgentsFile[] = [];
  let cur = resolve(cwd);
  // Hard cap on depth to defend against pathological symlink loops. 32 is
  // way beyond any real project tree but cheap.
  const MAX_DEPTH = 32;
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    const hit = readAgentsFileFromDir(cur);
    if (hit && !seen.has(pathKey(hit.path))) {
      ancestorHits.unshift(hit);
      seen.add(pathKey(hit.path));
    }
    const parent = dirname(cur);
    if (parent === cur) break; // reached filesystem root
    cur = parent;
  }
  out.push(...ancestorHits);
  return out;
}

/**
 * `DefaultResourceLoader.agentsFilesOverride` callback body.
 *
 * Returns a new payload with `base.agentsFiles` plus any single-name
 * `AGENT.md` / `agent.md` we discover under `cwd` or `agentDir`.
 *
 * De-duplication has two layers, both needed:
 *  1. **Path-level**: same file already in `base.agentsFiles` (case-
 *     insensitive on win32) → drop the extra. Defends against Pi's
 *     `loadContextFileFromDir` and our walker both hitting the same path
 *     under different case-spellings on Windows.
 *  2. **Directory-level**: a directory already covered by Pi's
 *     `AGENTS.md` / `CLAUDE.md` → drop the single-name variant in that
 *     same directory. Pi picks the first hit per dir from its
 *     `[AGENTS.md, AGENTS.MD, CLAUDE.md, CLAUDE.MD]` list; if any of
 *     those fired, we do NOT also append a singular `AGENT.md` from
 *     that same dir, even though they are different files on disk.
 *
 * Order in the merged list matches Pi's `loadProjectContextFiles`:
 * `global agentDir` first, then ancestor walks from root → cwd (so the
 * closest-to-cwd file ends up LAST in the array, hence LAST in the
 * system prompt — same as the existing `AGENTS.md` / `CLAUDE.md` order).
 */
export function augmentAgentsFiles(
  base: AgentsFilesPayload,
  opts: { cwd: string; agentDir: string },
): AgentsFilesPayload {
  const extra = loadAgentsMdFiles(opts.cwd, opts.agentDir);

  const seenPaths = new Set<string>();
  const seenDirs = new Set<string>();
  const merged: AgentsFile[] = [];
  for (const f of base.agentsFiles) {
    merged.push(f);
    seenPaths.add(pathKey(f.path));
    seenDirs.add(pathKey(dirname(f.path)));
  }
  for (const f of extra) {
    const pathK = pathKey(f.path);
    const dirK = pathKey(dirname(f.path));
    if (seenPaths.has(pathK)) continue;
    if (seenDirs.has(dirK)) continue;
    seenPaths.add(pathK);
    seenDirs.add(dirK);
    merged.push(f);
  }
  return { agentsFiles: merged };
}
