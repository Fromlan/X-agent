/**
 * Keyword search over a local godot-docs checkout (*.rst).
 * Prefers ripgrep; falls back to a Node walk when `rg` is unavailable.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  docsUrlForRst,
  getDocsRoot,
  normalizeGodotDocsBranch,
} from "./godot-docs-cache";

export type GodotDocsHit = {
  title: string;
  /** Repo-relative posix path, no leading ./ */
  relPath: string;
  /** Absolute filesystem path — use with the `read` tool. */
  absPath: string;
  snippet: string;
  score: number;
  branch: string;
  docsUrl: string;
};

export type GodotDocsSearchOptions = {
  query: string;
  branch: string;
  limit?: number;
  pathGlob?: string;
  /** When true, would auto-fetch docs; kept for API compat but ignored (manual import only). */
  autoEnsure?: boolean;
};

export type GodotDocsSearchResult = {
  ok: boolean;
  branch: string;
  hits: GodotDocsHit[];
  error?: string;
  truncated?: boolean;
};

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;
const MAX_TOTAL_CHARS = 10_000;
const SNIPPET_CONTEXT_LINES = 2;
const MAX_SNIPPET_CHARS = 500;

function clampLimit(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Normalize rg/node relative paths: strip leading ./ and unify separators. */
function normalizeRelPath(p: string): string {
  let s = toPosix(p).replace(/\\/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  while (s.startsWith("/")) s = s.slice(1);
  return s;
}

function extractTitle(lines: string[], hitLine: number): string {
  // Walk upward for underline title pattern: title\n====
  for (let i = hitLine; i >= 1; i--) {
    const underline = lines[i] ?? "";
    const title = (lines[i - 1] ?? "").trim();
    if (
      title &&
      underline.length >= 3 &&
      /^[=~\-^"+#*]+$/.test(underline.trim()) &&
      underline.trim().length >= Math.min(title.length, 3)
    ) {
      return title;
    }
  }
  // Fallback: first non-empty non-directive line
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("..") || t.startsWith(":")) continue;
    if (/^[=~\-^"+#*]+$/.test(t)) continue;
    return t.slice(0, 120);
  }
  return "(untitled)";
}

function makeSnippet(lines: string[], hitLine: number): string {
  const start = Math.max(0, hitLine - SNIPPET_CONTEXT_LINES);
  const end = Math.min(lines.length, hitLine + SNIPPET_CONTEXT_LINES + 1);
  const chunk = lines.slice(start, end).join("\n").trim();
  if (chunk.length <= MAX_SNIPPET_CHARS) return chunk;
  return `${chunk.slice(0, MAX_SNIPPET_CHARS)}\n…`;
}

function scoreHit(
  query: string,
  line: string,
  title: string,
  relPath: string,
): number {
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  let score = 0;
  const lineL = line.toLowerCase();
  const titleL = title.toLowerCase();
  const pathL = relPath.toLowerCase();
  for (const term of terms) {
    if (titleL.includes(term)) score += 8;
    if (pathL.includes(term)) score += 4;
    if (lineL.includes(term)) score += 2;
  }
  if (titleL.includes(q)) score += 5;
  if (lineL.includes(q)) score += 3;
  // Prefer class reference for class-like queries
  if (/^class[_\s]/i.test(query) || /[A-Z][a-zA-Z0-9]+/.test(query)) {
    if (pathL.includes("classes/")) score += 3;
  }
  return score;
}

function globToRegExp(glob: string): RegExp {
  // Minimal glob: * and ** only; case-insensitive path match
  const escaped = glob
    .replace(/\\/g, "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesGlob(relPosix: string, pathGlob?: string): boolean {
  if (!pathGlob || !pathGlob.trim()) return true;
  const g = pathGlob.trim().replace(/\\/g, "/");
  return globToRegExp(g).test(relPosix);
}

type RawMatch = { file: string; line: number; text: string };

function runRg(
  root: string,
  query: string,
): Promise<{ ok: boolean; matches: RawMatch[]; error?: string }> {
  return new Promise((resolvePromise) => {
    const args = [
      "--json",
      "--glob",
      "*.rst",
      "--max-count",
      "40",
      "-i",
      "--fixed-strings",
      query,
      ".",
    ];
    const child = spawn("rg", args, {
      cwd: root,
      windowsHide: true,
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
        ok: false,
        matches: [],
        error: err.message || String(err),
      });
    });
    child.on("close", (code) => {
      // rg: 0=match, 1=no match, 2=error
      if (code !== 0 && code !== 1) {
        resolvePromise({
          ok: false,
          matches: [],
          error: (stderr || `rg exited ${code}`).trim().slice(0, 400),
        });
        return;
      }
      const matches: RawMatch[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as {
            type?: string;
            data?: {
              path?: { text?: string };
              line_number?: number;
              lines?: { text?: string };
            };
          };
          if (obj.type !== "match" || !obj.data?.path?.text) continue;
          matches.push({
            file: obj.data.path.text,
            line: (obj.data.line_number ?? 1) - 1,
            text: (obj.data.lines?.text ?? "").replace(/\n$/, ""),
          });
        } catch {
          // skip bad json lines
        }
      }
      resolvePromise({ ok: true, matches });
    });
  });
}

function walkRstFiles(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === ".git" || name === "_static" || name === "_templates") continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkRstFiles(full, acc);
    else if (st.isFile() && name.endsWith(".rst")) acc.push(full);
  }
}

function nodeSearch(root: string, query: string): RawMatch[] {
  const files: string[] = [];
  walkRstFiles(root, files);
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const matches: RawMatch[] = [];
  const maxFiles = 800;
  const scanned = files.slice(0, maxFiles);

  for (const file of scanned) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Skip huge files
    if (content.length > 400_000) continue;
    const lines = content.split(/\r?\n/);
    let fileHits = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lower = line.toLowerCase();
      const hit =
        lower.includes(q) ||
        (terms.length > 1 && terms.every((t) => lower.includes(t)));
      if (!hit) continue;
      matches.push({
        file: relative(root, file),
        line: i,
        text: line,
      });
      fileHits += 1;
      if (fileHits >= 3) break;
      if (matches.length >= 80) return matches;
    }
  }
  return matches;
}

function buildHits(
  root: string,
  branch: string,
  query: string,
  raw: RawMatch[],
  limit: number,
  pathGlob?: string,
): { hits: GodotDocsHit[]; truncated: boolean } {
  const byFile = new Map<string, GodotDocsHit>();
  const absRoot = resolve(root);

  for (const m of raw) {
    const relPosix = normalizeRelPath(m.file);
    if (!relPosix || !matchesGlob(relPosix, pathGlob)) continue;

    const abs = resolve(absRoot, relPosix);
    let lines: string[];
    try {
      lines = readFileSync(abs, "utf8").split(/\r?\n/);
    } catch {
      continue;
    }
    const title = extractTitle(lines, m.line);
    const snippet = makeSnippet(lines, m.line);
    const score = scoreHit(query, m.text, title, relPosix);
    const prev = byFile.get(relPosix);
    if (!prev || score > prev.score) {
      byFile.set(relPosix, {
        title,
        relPath: relPosix,
        absPath: abs,
        snippet,
        score,
        branch,
        docsUrl: docsUrlForRst(branch, relPosix),
      });
    }
  }

  const sorted = [...byFile.values()].sort((a, b) => b.score - a.score);
  const picked: GodotDocsHit[] = [];
  let total = 0;
  let truncated = false;
  for (const hit of sorted) {
    if (picked.length >= limit) {
      truncated = true;
      break;
    }
    const cost =
      hit.title.length +
      hit.relPath.length +
      hit.absPath.length +
      hit.snippet.length +
      100;
    if (total + cost > MAX_TOTAL_CHARS && picked.length > 0) {
      truncated = true;
      break;
    }
    picked.push(hit);
    total += cost;
  }
  return { hits: picked, truncated };
}

export async function searchGodotDocs(
  options: GodotDocsSearchOptions,
): Promise<GodotDocsSearchResult> {
  const branch = normalizeGodotDocsBranch(options.branch);
  const query = options.query.trim();
  if (!query) {
    return { ok: false, branch, hits: [], error: "查询不能为空" };
  }
  const limit = clampLimit(options.limit);
  const root = getDocsRoot(branch);
  if (!existsSync(join(root, "index.rst"))) {
    return {
      ok: false,
      branch,
      hits: [],
      error: `文档版本「${branch}」尚未导入。请在设置 → Godot 中打开下载链接获取 zip，再点「导入 zip」。`,
    };
  }

  let raw: RawMatch[] = [];
  const rg = await runRg(root, query);
  if (rg.ok) {
    raw = rg.matches;
  } else {
    // Fallback when rg missing or failed
    raw = nodeSearch(root, query);
  }

  const { hits, truncated } = buildHits(
    root,
    branch,
    query,
    raw,
    limit,
    options.pathGlob,
  );

  return { ok: true, branch, hits, truncated };
}
