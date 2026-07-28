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
  /** Short readable summary (class Description or tutorial lead). */
  summary: string;
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
const MAX_SUMMARY_CHARS = 300;

const GENERIC_SECTION_TITLES = new Set([
  "signals",
  "methods",
  "properties",
  "constants",
  "enumerations",
  "theme properties",
  "description",
  "tutorials",
  "operators",
  "annotations",
  "constructor",
  "constructors",
]);

const CONCEPT_QUERY_RE =
  /^(signal|signals|tween|animation|node|scene|input|physics|shader)$/i;

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

function normalizeClassToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isClassRefPath(relPath: string): boolean {
  return /^classes\/class_[^/]+\.rst$/i.test(relPath);
}

function classFileStem(relPath: string): string | null {
  const m = relPath.match(/^classes\/class_([^/]+)\.rst$/i);
  return m ? m[1]! : null;
}

function isUnderline(line: string): boolean {
  const t = line.trim();
  return t.length >= 3 && /^[=~\-^"+#*]+$/.test(t);
}

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith("..")) return true;
  if (t.startsWith(":")) return true;
  if (isUnderline(t)) return true;
  return false;
}

function isTitleUnderlinePair(title: string, underline: string): boolean {
  const u = underline.trim();
  return (
    !!title.trim() &&
    u.length >= 3 &&
    isUnderline(u) &&
    u.length >= Math.min(title.trim().length, 3)
  );
}

/** First page-level RST title (title + underline). */
function extractPageTitle(lines: string[]): string | null {
  for (let i = 1; i < lines.length; i++) {
    const title = (lines[i - 1] ?? "").trim();
    const underline = lines[i] ?? "";
    if (!isTitleUnderlinePair(title, underline)) continue;
    if (title.startsWith("..") || title.startsWith(":")) continue;
    return title.slice(0, 120);
  }
  return null;
}

function sectionTitleAt(lines: string[], hitLine: number): string | null {
  for (let i = hitLine; i >= 1; i--) {
    const underline = lines[i] ?? "";
    const title = (lines[i - 1] ?? "").trim();
    if (isTitleUnderlinePair(title, underline)) return title;
  }
  return null;
}

function extractTitle(
  lines: string[],
  hitLine: number,
  relPath: string,
): string {
  if (isClassRefPath(relPath)) {
    const page = extractPageTitle(lines);
    if (page) return page;
    const stem = classFileStem(relPath);
    if (stem) return stem;
  }

  const near = sectionTitleAt(lines, hitLine);
  if (near && !GENERIC_SECTION_TITLES.has(near.toLowerCase())) {
    return near.slice(0, 120);
  }
  const page = extractPageTitle(lines);
  if (page) return page;
  if (near) return near.slice(0, 120);

  for (const line of lines) {
    const t = line.trim();
    if (isNoiseLine(t)) continue;
    return t.slice(0, 120);
  }
  return "(untitled)";
}

/**
 * Prefer classref Description prose; otherwise first non-noise paragraphs
 * after the page title / inheritance line.
 */
function extractSummary(lines: string[], relPath: string): string {
  const chunks: string[] = [];

  const pushProse = (start: number, end: number) => {
    for (let i = start; i < end && i < lines.length; i++) {
      const raw = lines[i] ?? "";
      const t = raw.trim();
      if (!t) {
        if (chunks.length > 0) break;
        continue;
      }
      if (isNoiseLine(t)) continue;
      if (/^\*\*Inherits:\*\*/i.test(t) || /^Inherits:/i.test(t)) continue;
      if (isTitleUnderlinePair(t, lines[i + 1] ?? "")) {
        // Next section heading — stop if we already have prose
        if (chunks.length > 0) break;
        i += 1;
        continue;
      }
      chunks.push(t);
      const joined = chunks.join(" ");
      if (joined.length >= MAX_SUMMARY_CHARS) break;
    }
  };

  if (isClassRefPath(relPath)) {
    let descStart = -1;
    for (let i = 1; i < lines.length; i++) {
      const title = (lines[i - 1] ?? "").trim();
      if (
        /^description$/i.test(title) &&
        isTitleUnderlinePair(title, lines[i] ?? "")
      ) {
        descStart = i + 1;
        break;
      }
    }
    if (descStart >= 0) {
      pushProse(descStart, lines.length);
    } else {
      // Class pages often put a one-line blurb before Description
      const pageTitle = extractPageTitle(lines);
      let start = 0;
      if (pageTitle) {
        for (let i = 1; i < lines.length; i++) {
          if ((lines[i - 1] ?? "").trim() === pageTitle) {
            start = i + 1;
            break;
          }
        }
      }
      pushProse(start, Math.min(lines.length, start + 40));
    }
  } else {
    const pageTitle = extractPageTitle(lines);
    let start = 0;
    if (pageTitle) {
      for (let i = 1; i < lines.length; i++) {
        if ((lines[i - 1] ?? "").trim() === pageTitle) {
          start = i + 1;
          break;
        }
      }
    }
    pushProse(start, Math.min(lines.length, start + 60));
  }

  let summary = chunks.join(" ").replace(/\s+/g, " ").trim();
  if (summary.length > MAX_SUMMARY_CHARS) {
    summary = `${summary.slice(0, MAX_SUMMARY_CHARS)}…`;
  }
  return summary;
}

function makeMatchContext(lines: string[], hitLine: number): string {
  const collected: string[] = [];
  const start = Math.max(0, hitLine - SNIPPET_CONTEXT_LINES);
  const end = Math.min(lines.length, hitLine + SNIPPET_CONTEXT_LINES + 1);
  for (let i = start; i < end; i++) {
    const t = (lines[i] ?? "").trimEnd();
    if (isNoiseLine(t) && i !== hitLine) continue;
    collected.push(t);
  }
  return collected.join("\n").trim();
}

function makeSnippet(
  lines: string[],
  hitLine: number,
  relPath: string,
  summary: string,
): string {
  const parts: string[] = [];
  if (summary) parts.push(summary);

  if (isClassRefPath(relPath)) {
    // Match near the top (generator / class anchor) → summary is enough
    const section = sectionTitleAt(lines, hitLine)?.toLowerCase() ?? "";
    const nearTop = hitLine < 20;
    if (
      !nearTop &&
      section &&
      section !== "description" &&
      !summary.toLowerCase().includes((lines[hitLine] ?? "").trim().toLowerCase())
    ) {
      const ctx = makeMatchContext(lines, hitLine);
      if (ctx) parts.push(`Match (${section || "context"}):\n${ctx}`);
    }
  } else {
    const ctx = makeMatchContext(lines, hitLine);
    if (ctx && (!summary || !summary.includes(ctx.split("\n")[0] ?? ""))) {
      // Prefer context when it adds match-local signal beyond the lead summary
      if (!summary) parts.push(ctx);
      else if (!nearSummaryOverlap(summary, ctx)) {
        parts.push(`Match:\n${ctx}`);
      }
    } else if (!summary && ctx) {
      parts.push(ctx);
    }
  }

  let snippet = parts.join("\n\n").trim();
  if (!snippet) {
    snippet = makeMatchContext(lines, hitLine) || "(no excerpt)";
  }
  if (snippet.length <= MAX_SNIPPET_CHARS) return snippet;
  return `${snippet.slice(0, MAX_SNIPPET_CHARS)}\n…`;
}

function nearSummaryOverlap(summary: string, ctx: string): boolean {
  const head = ctx.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!head || head.length < 12) return false;
  return summary.includes(head.slice(0, Math.min(40, head.length)));
}

function scoreHit(
  query: string,
  line: string,
  title: string,
  relPath: string,
  hitLine: number,
  lines: string[],
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

  // Exact class file match (class_animationplayer.rst ↔ AnimationPlayer)
  const stem = classFileStem(relPath);
  if (stem && normalizeClassToken(stem) === normalizeClassToken(query)) {
    score += 30;
  } else if (
    stem &&
    terms.some((t) => normalizeClassToken(stem) === normalizeClassToken(t))
  ) {
    score += 30;
  }

  // Demote hits that only land in generic classref sections for non-class queries
  const section = sectionTitleAt(lines, hitLine)?.toLowerCase() ?? "";
  const queryIsThisClass =
    !!stem && normalizeClassToken(stem) === normalizeClassToken(query);
  if (
    isClassRefPath(relPath) &&
    GENERIC_SECTION_TITLES.has(section) &&
    section !== "description" &&
    !queryIsThisClass
  ) {
    score -= 12;
  }

  if (pathL.startsWith("engine_details/")) score -= 4;

  if (CONCEPT_QUERY_RE.test(query.trim())) {
    if (
      pathL.startsWith("getting_started/") ||
      pathL.startsWith("tutorials/scripting/") ||
      pathL.startsWith("tutorials/")
    ) {
      score += 6;
    }
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

/** Turn user path_glob into rg --glob patterns that still require .rst. */
function pathGlobToRgGlobs(pathGlob?: string): string[] {
  if (!pathGlob || !pathGlob.trim()) return ["*.rst"];
  const g = pathGlob.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (g.endsWith(".rst") || g.includes(".rst")) return [g];
  if (g.endsWith("/**")) {
    const base = g.slice(0, -3);
    return [`${base}/*.rst`, `${base}/**/*.rst`];
  }
  if (g.endsWith("/*")) {
    const base = g.slice(0, -2);
    return [`${base}/*.rst`];
  }
  if (g.endsWith("/")) {
    return [`${g}*.rst`, `${g}**/*.rst`];
  }
  // bare dir or pattern — constrain to rst under it
  return [`${g}.rst`, `${g}/*.rst`, `${g}/**/*.rst`];
}

type RawMatch = { file: string; line: number; text: string };

function parseRgJson(stdout: string): RawMatch[] {
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
  return matches;
}

function runRgOnce(
  root: string,
  query: string,
  pathGlob?: string,
): Promise<{ ok: boolean; matches: RawMatch[]; error?: string }> {
  return new Promise((resolvePromise) => {
    const args = ["--json", "--max-count", "40", "-i", "--fixed-strings"];
    for (const g of pathGlobToRgGlobs(pathGlob)) {
      args.push("--glob", g);
    }
    args.push(query, ".");
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
      resolvePromise({ ok: true, matches: parseRgJson(stdout) });
    });
  });
}

function mergeRawMatches(groups: RawMatch[][]): RawMatch[] {
  const seen = new Set<string>();
  const out: RawMatch[] = [];
  for (const group of groups) {
    for (const m of group) {
      const key = `${normalizeRelPath(m.file)}:${m.line}:${m.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

async function runRg(
  root: string,
  query: string,
  pathGlob?: string,
): Promise<{ ok: boolean; matches: RawMatch[]; error?: string }> {
  const terms = query.split(/\s+/).filter(Boolean);
  const primary = await runRgOnce(root, query, pathGlob);
  if (!primary.ok) return primary;

  if (terms.length <= 1) return primary;

  // Multi-word: also search each term and union (fixed-string full query is too strict)
  const termResults = await Promise.all(
    terms.map((t) => runRgOnce(root, t, pathGlob)),
  );
  if (termResults.some((r) => !r.ok)) {
    // Prefer primary if term searches failed oddly; still ok if primary worked
    return primary;
  }
  return {
    ok: true,
    matches: mergeRawMatches([
      primary.matches,
      ...termResults.map((r) => r.matches),
    ]),
  };
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

function nodeSearch(
  root: string,
  query: string,
  pathGlob?: string,
): RawMatch[] {
  const files: string[] = [];
  walkRstFiles(root, files);
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const matches: RawMatch[] = [];
  const maxFiles = 800;
  const scanned = files.slice(0, maxFiles);

  for (const file of scanned) {
    const rel = normalizeRelPath(relative(root, file));
    if (!matchesGlob(rel, pathGlob)) continue;
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
  const fileCache = new Map<string, string[]>();

  const readLines = (abs: string): string[] | null => {
    const cached = fileCache.get(abs);
    if (cached) return cached;
    try {
      const lines = readFileSync(abs, "utf8").split(/\r?\n/);
      fileCache.set(abs, lines);
      return lines;
    } catch {
      return null;
    }
  };

  for (const m of raw) {
    const relPosix = normalizeRelPath(m.file);
    if (!relPosix || !matchesGlob(relPosix, pathGlob)) continue;

    const abs = resolve(absRoot, relPosix);
    const lines = readLines(abs);
    if (!lines) continue;

    const title = extractTitle(lines, m.line, relPosix);
    const summary = extractSummary(lines, relPosix);
    const snippet = makeSnippet(lines, m.line, relPosix, summary);
    const score = scoreHit(query, m.text, title, relPosix, m.line, lines);
    const prev = byFile.get(relPosix);
    if (!prev || score > prev.score) {
      byFile.set(relPosix, {
        title,
        relPath: relPosix,
        absPath: abs,
        summary,
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
      hit.summary.length +
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
  const rg = await runRg(root, query, options.pathGlob);
  if (rg.ok) {
    raw = rg.matches;
  } else {
    // Fallback when rg missing or failed
    raw = nodeSearch(root, query, options.pathGlob);
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
