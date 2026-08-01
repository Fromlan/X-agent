/**
 * Classify bash commands as read-only for Ask/Plan hard gates.
 * Conservative: unknown / mixed / redirect-heavy / path-escaping commands are writes.
 */
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

/** Commands that are generally safe for codebase research (no mutation). */
const READONLY_COMMAND_HEADS = new Set([
  "ls",
  "dir",
  "pwd",
  "echo",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "wc",
  "file",
  "stat",
  "type",
  "which",
  "where",
  "whereis",
  "whoami",
  "uname",
  "date",
  "env",
  "printenv",
  "true",
  "false",
  "test",
  "[",
  "find",
  "grep",
  "rg",
  "ag",
  "ack",
  "fd",
  "tree",
  "du",
  "df",
  "realpath",
  "readlink",
  "basename",
  "dirname",
  "jq",
  "yq",
  "git",
  "godot",
  "dotnet",
]);

/** git subcommands allowed in Ask/Plan (status/diff/log/show…). */
const READONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "branch",
  "tag",
  "remote",
  "rev-parse",
  "rev-list",
  "describe",
  "ls-files",
  "ls-tree",
  "cat-file",
  "blame",
  "shortlog",
  "config", // get-only in practice; still block --unset via mutation patterns below
  "stash", // only `stash list` / `stash show` — checked below
]);

/** Patterns that imply mutation even if the head looks read-only. */
const MUTATION_PATTERNS: RegExp[] = [
  /(^|[|&;]\s*)(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|ln|dd|truncate|tee)\b/i,
  /(^|[|&;]\s*)(npm|pnpm|yarn|bun)\s+(install|add|remove|uninstall|publish|update|upgrade)/i,
  /(^|[|&;]\s*)(pip|pip3)\s+(install|uninstall)/i,
  /(^|[|&;]\s*)git\s+(add|commit|push|pull|fetch|merge|rebase|reset|checkout|switch|cherry-pick|tag\s+-d|branch\s+-[dD]|clean|stash\s+(push|pop|apply|drop|clear))/i,
  /(^|[|&;]\s*)(sed|perl|ruby)\s+.*\s-i\b/i,
  /(^|[|&;]\s*)(python|python3|node|nodejs)\b/i,
  /\bfind\b[\s\S]*\s-(?:delete|exec|execdir|ok|okdir)\b/i,
  /(?:^|[^>])>(?!>)\s*[^|&;]/, // single > redirect to a file
  />>/,
  /\|\s*tee\b/i,
];

function stripShellNoise(command: string): string {
  return command
    .replace(/^\s*(?:sudo\s+)+/i, "")
    .replace(/^\s*(?:command\s+)+/i, "")
    .replace(/^\s*(?:env\s+(?:-i\s+)?(?:[A-Za-z_][\w]*=\S+\s+)*)/i, "")
    .trim();
}

function firstToken(segment: string): string {
  const m = segment.trim().match(/^([^\s]+)/);
  return (m?.[1] ?? "").replace(/^["']|["']$/g, "");
}

function splitShellSegments(command: string): string[] {
  // Split on ; | && || while keeping it simple (no full shell parser).
  return command
    .split(/(?:&&|\|\||[;|])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isReadonlyGit(segment: string): boolean {
  const tokens = segment.trim().split(/\s+/);
  // git [-C path] <sub>
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    if (
      tokens[i] === "-C" ||
      tokens[i] === "--git-dir" ||
      tokens[i] === "--work-tree"
    ) {
      i += 2;
      continue;
    }
    i += 1;
  }
  const sub = (tokens[i] ?? "").toLowerCase();
  if (!READONLY_GIT_SUBCOMMANDS.has(sub)) return false;
  if (sub === "stash") {
    const stashOp = (tokens[i + 1] ?? "list").toLowerCase();
    return stashOp === "list" || stashOp === "show";
  }
  if (sub === "config") {
    // Block mutating config writes: `git config name value` or --unset / --add
    const rest = tokens.slice(i + 1).join(" ");
    if (/\b--(?:unset|add|remove-section)\b/i.test(rest)) return false;
    // `git config --get` / `--list` / single-arg get are OK; two+ non-flag args ≈ set
    const nonFlags = tokens.slice(i + 1).filter((t) => !t.startsWith("-"));
    return nonFlags.length <= 1;
  }
  return true;
}

function unquote(token: string): string {
  const t = token.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function isPathLikeToken(token: string): boolean {
  const t = unquote(token);
  if (!t || t === "." || t === "-" || t.startsWith("-")) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false; // URLs
  if (t.includes("/") || t.includes("\\")) return true;
  if (/^[A-Za-z]:/.test(t)) return true;
  if (t === ".." || t.startsWith("../") || t.startsWith("..\\")) return true;
  return false;
}

function pathEscapesCwd(cwd: string, pathToken: string): boolean {
  const cleaned = unquote(pathToken);
  if (!cleaned) return false;
  const root = normalize(resolve(cwd));
  let abs: string;
  try {
    if (isAbsolute(cleaned) || /^[A-Za-z]:[\\/]/.test(cleaned)) {
      abs = normalize(resolve(cleaned));
    } else {
      abs = normalize(resolve(root, cleaned));
    }
  } catch {
    return true;
  }
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return true;
  if (abs !== root && !abs.startsWith(root + sep)) return true;
  return false;
}

/**
 * True when the command references a path outside project cwd
 * (absolute escape, `..`, or `git -C` / `--git-dir` / `--work-tree` outside).
 */
export function bashCommandEscapesCwd(command: string, cwd: string): boolean {
  const root = (cwd ?? "").trim();
  if (!root) return false;
  const cleaned = stripShellNoise(command);
  if (!cleaned) return false;

  for (const segment of splitShellSegments(cleaned)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const lower = tok.toLowerCase();
      if (
        lower === "-c" ||
        lower === "--git-dir" ||
        lower === "--work-tree" ||
        lower === "--prefix"
      ) {
        const next = tokens[i + 1];
        if (next && pathEscapesCwd(root, next)) return true;
        i += 1;
        continue;
      }
      if (isPathLikeToken(tok) && pathEscapesCwd(root, tok)) return true;
    }
  }
  return false;
}

/** True when the whole command is safe for Ask/Plan bash allowlist. */
export function isReadonlyBashCommand(command: string): boolean {
  const raw = (command ?? "").trim();
  if (!raw) return false;
  if (MUTATION_PATTERNS.some((re) => re.test(raw))) return false;

  const cleaned = stripShellNoise(raw);
  if (!cleaned) return false;

  for (const segment of splitShellSegments(cleaned)) {
    if (MUTATION_PATTERNS.some((re) => re.test(segment))) return false;
    const head = firstToken(segment).toLowerCase();
    if (!head || !READONLY_COMMAND_HEADS.has(head)) return false;
    if (head === "git" && !isReadonlyGit(segment)) return false;
  }
  return true;
}

export function readonlyBashBlockReason(command: string): string {
  return `调研/Plan 模式仅允许只读 bash（如 git status、ls、rg），且路径须在项目目录内。已拦截：${command.slice(0, 120)}`;
}

export function cwdEscapeBashBlockReason(command: string): string {
  return `调研/Plan 模式禁止 bash 访问项目目录外路径。已拦截：${command.slice(0, 120)}`;
}
