/**
 * Classify bash commands as read-only for Ask/Plan hard gates.
 * Conservative: unknown / mixed / redirect-heavy / path-escaping commands are writes.
 */
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

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
  /(^|[|&;]\s*)git\s+(add|commit|push|pull|fetch|merge|rebase|reset|checkout|switch|cherry-pick|tag\s+-d|branch\s+-[dD]|clean|stash\s+(push|pop|apply|drop|clear)|remote\s+(add|set-url|remove|rename|set-head))/i,
  /(^|[|&;]\s*)(sed|perl|ruby)\s+.*\s-i\b/i,
  /(^|[|&;]\s*)(python|python3|node|nodejs)\b/i,
  /\bfind\b[\s\S]*\s-(?:delete|exec|execdir|ok|okdir)\b/i,
  /(?:^|[^>])>(?!>)/, // any single `>` redirect (incl. `>|`); `>>` also matches the second `>`
  />>/,
  /</, // input redirect
  /\|\s*tee\b/i,
  /^date\b[\s\S]*\s-{1,2}(?:s|set)\b/i, // `date -s` / `date --set` mutates the clock
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

/**
 * Reject command substitution / expansion that can hide mutating payloads:
 * `$(…)`, `${…}`, backticks, `$VAR` / `$'…'` / `$"…"` / `$$` / `$?` / `$!` etc.
 * NOTE: single-quoted `$VAR` is not expanded by bash, but we fail closed —
 * Ask/Plan bash is a hard gate, false positives are acceptable.
 */
function hasShellSubstitution(command: string): boolean {
  return (
    /\$\(|\$\{|`/.test(command) ||
    /\$[A-Za-z_][A-Za-z0-9_]*/.test(command) ||
    /\$[$?#@*!0-9]/.test(command) ||
    /\$['"]/.test(command)
  );
}

function splitShellSegments(command: string): string[] {
  // Split on newlines, ; | && || while keeping it simple (no full shell parser).
  // Newlines must be segments: otherwise `ls\nrm -rf x` looks like a single `ls` head.
  return command
    .split(/\r\n|\r|\n|(?:&&|\|\||[;|])/)
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
    // Bare `git stash` = `git stash push` (moves working-tree changes into the
    // stash and reverts files): require an explicit read-only subcommand.
    const stashOp = (tokens[i + 1] ?? "").toLowerCase();
    return stashOp === "list" || stashOp === "show";
  }
  if (sub === "branch" || sub === "tag") {
    // `git branch foo` / `git tag v1` create refs (write .git/refs).
    // Read-only forms use only flags (`-a`/`-v`/`--show-current`…);
    // any positional arg may be a new ref name → block (fail closed, so
    // `--merged <branch>` lists are also rejected). Exception: `tag -l`
    // / `tag --list` takes an optional filter pattern that is not a write.
    const rest = tokens.slice(i + 1);
    if (
      sub === "tag" &&
      (rest[0] === "-l" || rest[0] === "--list") &&
      rest.slice(1).length <= 1
    ) {
      return true;
    }
    return rest.every((t) => t.startsWith("-"));
  }
  if (sub === "remote") {
    // `remote add|set-url|remove|rename|set-head` write .git/config;
    // plain `remote`, `-v`, `show <name>`, `get-url <name>` are reads.
    const op = (tokens[i + 1] ?? "").toLowerCase();
    return !["add", "set-url", "remove", "rename", "set-head"].includes(op);
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
  if (t.startsWith("~")) return true; // ~ / ~/... / ~user/... expand to HOME
  if (t.includes("/") || t.includes("\\")) return true;
  if (/^[A-Za-z]:/.test(t)) return true;
  if (t === ".." || t.startsWith("../") || t.startsWith("..\\")) return true;
  return false;
}

/**
 * Expand `~` / `~/…` against the current user HOME (Git Bash HOME ==
 * %USERPROFILE% on Windows). `~user/…` is unknown → left as-is (fails the
 * cwd check downstream unless it resolves inside the project).
 */
function expandTilde(token: string): string {
  if (!token.startsWith("~")) return token;
  if (token === "~" || token.startsWith("~/") || token.startsWith("~\\")) {
    return join(homedir(), token.slice(1));
  }
  return token;
}

function pathEscapesCwd(cwd: string, pathToken: string): boolean {
  const cleaned = expandTilde(unquote(pathToken));
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
  // Reject real `..` escapes only (`..foo` is a legal sibling-named dir).
  const firstSeg = rel.split(sep)[0];
  if (firstSeg === ".." || isAbsolute(rel)) return true;
  // Case-normalize on win32 (NTFS is case-insensitive) so a differently-cased
  // in-cwd path is not falsely flagged as an escape.
  if (process.platform === "win32") {
    const lowerRoot = root.toLowerCase();
    const lowerAbs = abs.toLowerCase();
    if (lowerAbs !== lowerRoot && !lowerAbs.startsWith(lowerRoot + sep)) {
      return true;
    }
  } else if (abs !== root && !abs.startsWith(root + sep)) {
    return true;
  }
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
  if (hasShellSubstitution(raw)) return false;
  if (MUTATION_PATTERNS.some((re) => re.test(raw))) return false;

  const cleaned = stripShellNoise(raw);
  if (!cleaned) return false;
  if (hasShellSubstitution(cleaned)) return false;

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
