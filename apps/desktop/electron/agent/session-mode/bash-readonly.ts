/**
 * Classify bash commands as read-only for Ask/Plan hard gates.
 * Conservative: unknown / mixed / redirect-heavy / path-escaping commands are writes.
 */
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { lstatSync, readdirSync } from "node:fs";
import { isPhysicallyInside } from "../lib/path-boundary";

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

/** Strip known wrappers without executing or interpreting shell expansion. */
function stripShellNoise(command: string): string {
  return command
    .replace(/^\s*(?:sudo\s+)+/i, "")
    .replace(/^\s*(?:command\s+)+/i, "")
    .replace(/^\s*env\s+(?:-i\s+)?(?=[^\s=]+(?:\s|$))(?!(?:[^\s]*=))/, "")
    .trim();
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

/** Preserve quoted argument boundaries and reject shell syntax we cannot safely classify. */
function tokenizeShellSegments(command: string): string[][] | null {
  const segments: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let active = false;
  let quote: "'" | '"' | null = null;
  /** Flush one argument, including an explicitly quoted empty argument. */
  const flushToken = () => {
    if (active) tokens.push(token);
    token = "";
    active = false;
  };
  /** Flush one command in a pipeline or command sequence. */
  const flushSegment = () => {
    flushToken();
    if (tokens.length) segments.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (ch === "\0") return null;
    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"' && ch === "\\" && /["\\]/.test(command[i + 1] ?? "")) token += command[++i];
      else token += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; active = true; continue; }
    // Escaped metacharacters can disguise option names and path traversals; fail closed.
    if (ch === "\\" && /[\s'";&|{}()<>]/.test(command[i + 1] ?? "")) return null;
    if (/[{}()<>]/.test(ch)) return null;
    if (ch === "&") {
      if (command[i + 1] !== "&") return null;
      i += 1;
      flushSegment();
    } else if (ch === ";" || ch === "|" || ch === "\r" || ch === "\n") {
      if (ch === "|" && command[i + 1] === "|") i += 1;
      flushSegment();
    } else if (/\s/.test(ch)) flushToken();
    else { token += ch; active = true; }
  }
  if (quote) return null;
  flushSegment();
  return segments;
}

/** Check Git subcommand and option semantics, including options that execute external programs. */
function isReadonlyGit(tokens: readonly string[]): boolean {
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
    if (/^-C.+/.test(tokens[i]) || /^--(?:git-dir|work-tree)=/.test(tokens[i])) { i += 1; continue; }
    if (!["--no-pager", "--no-optional-locks", "--literal-pathspecs", "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs"].includes(tokens[i])) return false;
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
    if (rest.some((t) => /^(?:-[a-zA-Z]*[dDmMcCfFu]|--(?:delete|move|copy|force|edit-description|set-upstream|unset-upstream))/.test(t))) return false;
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
    const remoteArgs = tokens.slice(i + 1);
    while (remoteArgs[0] === "-v" || remoteArgs[0] === "--verbose") remoteArgs.shift();
    const op = (remoteArgs[0] ?? "").toLowerCase();
    return !op || op === "show" || op === "get-url";
  }
  if (sub === "config") {
    // Block mutating config writes: `git config name value` or --unset / --add
    const rest = tokens.slice(i + 1).join(" ");
    if (/\b--(?:unset|add|remove-section|rename-section|edit|replace-all)\b/i.test(rest)) return false;
    if (/\b(?:set|unset|edit|remove-section|rename-section)\b/.test(tokens[i + 1] ?? "")) return false;
    // `git config --get` / `--list` / single-arg get are OK; two+ non-flag args ≈ set
    const configArgs = tokens.slice(i + 1);
    const nonFlags: string[] = [];
    for (let j = 0; j < configArgs.length; j += 1) {
      const arg = configArgs[j];
      const option = arg.split("=")[0];
      if (option === "-e" || ["--edit", "--unset", "--unset-all", "--add", "--remove-section", "--rename-section", "--replace-all", "--global", "--system"].some((unsafe) => option.startsWith("--") && unsafe.startsWith(option))) return false;
      if (["-f", "--file", "-t", "--type", "--default", "--blob"].includes(arg)) { j += 1; continue; }
      if (!arg.startsWith("-")) nonFlags.push(arg);
    }
    return nonFlags.length <= 1;
  }
  return true;
}

/** Reject side-effecting options even when the executable itself is a read command. */
function hasUnsafeArguments(tokens: readonly string[]): boolean {
  const head = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  // `env` without a command is a read; quoted/nested wrappers must not dispatch arbitrary executables.
  if (head === "env" && args.some((arg) => !["-0", "--null", "-i", "--ignore-environment", "--help", "--version"].includes(arg))) return true;
  if (args.some((arg) => arg.startsWith("-") && arg.split("=")[0].includes("\\"))) return true;
  const patterns: Record<string, readonly RegExp[]> = {
    git: [/^--(?:output|ext-diff|textconv|filters|exec-path|config-env|paginate)(?:=|$)/, /^-c(?:.|$)/, /^--config(?:=|$)/],
    find: [/^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls|L)$/],
    fd: [/^--(?:exec|exec-batch|follow)(?:=|$)/, /^-[^-]*[xXL]/],
    rg: [/^--(?:pre|hostname-bin|follow)(?:=|$)/, /^-[^-]*L/],
    grep: [/^--dereference-recursive(?:=|$)/, /^-[^-]*R/],
    ag: [/^--pager(?:=|$)/],
    ack: [/^--pager(?:=|$)/],
    yq: [/^--(?:inplace|in-place|split-exp|split-file|output-file|from-file)(?:=|$)/, /^-[^-]*[is]/, /\bload(?:_str|_base64|_xml|_props|_csv|_tsv)?\s*\(/],
    jq: [/\b(?:include|import)\s/, /^--from-file(?:=|$)/, /^-[^-]*f/],
    file: [/^--compile(?:=|$)/, /^-[^-]*C/],
    tree: [/^-[^-]*[ol]/, /^--outfile(?:=|$)/],
    ls: [/^--dereference(?:=|$)/, /^-[^-]*L/],
    du: [/^--dereference(?:=|$)/, /^-[^-]*L/],
    less: [/^-[oO](?:.|$)/, /^--(?:log-file|LOG-FILE)(?:=|$)/, /^\+/],
    date: [/^--set(?:=|$)/, /^-s(?:.|$)/],
  };
  const unsafeLongOptions: Record<string, readonly string[]> = {
    git: ["--output", "--ext-diff", "--textconv", "--filters", "--exec-path", "--config-env", "--paginate"],
    file: ["--compile"],
    jq: ["--from-file"],
    yq: ["--inplace", "--in-place", "--split-exp", "--split-file", "--output-file", "--from-file"],
    rg: ["--pre", "--hostname-bin", "--follow"],
    fd: ["--exec", "--exec-batch", "--follow"],
    grep: ["--dereference-recursive"],
    tree: ["--outfile"],
    less: ["--log-file", "--LOG-FILE"],
    ls: ["--dereference"],
    du: ["--dereference"],
    date: ["--set"],
  };
  const forbidden = patterns[head] ?? [];
  // Git and GNU utilities accept abbreviated long options; reject unsafe prefixes too.
  return args.some((arg) => forbidden.some((pattern) => pattern.test(arg)) ||
    (/^--[a-zA-Z-]+(?:=|$)/.test(arg) &&
      (unsafeLongOptions[head] ?? []).some((option) => option.startsWith(arg.split("=")[0]))));
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

/**
 * True when the resolved path is inside any of the allowed roots
 * (case-normalized prefix check, win32-safe). Used to extend the Ask/Plan
 * sandbox from project cwd to read-only plugin roots (skills/prompts/…).
 */
function isInsideAnyRoot(abs: string, roots: readonly string[]): boolean {
  if (!roots || roots.length === 0) return false;
  for (const rootRaw of roots) {
    const root = normalize(resolve(rootRaw));
    if (!isPhysicallyInside(root, abs)) continue;
    if (root === abs) return true;
    const prefix = root.endsWith(sep) ? root : root + sep;
    if (
      process.platform === "win32"
        ? abs.toLowerCase().startsWith(prefix.toLowerCase())
        : abs.startsWith(prefix)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * True when the path token escapes the allowed read areas: project cwd plus
 * optional read-only roots (e.g. plugin/skill dirs) that are always readable.
 */
function pathEscapesReadArea(
  cwd: string,
  pathToken: string,
  allowedRoots?: readonly string[],
): boolean {
  if (/^~[^/\\]/.test(pathToken)) return true; // Unknown user-home expansion cannot be resolved safely.
  let cleaned = expandTilde(unquote(pathToken));
  // Git Bash maps /c/... to C:/..., while node:path would interpret it on the current drive.
  if (process.platform === "win32") {
    cleaned = cleaned.replace(/^\/([a-z])(?:\/|$)/i, "$1:/");
    // Other POSIX absolute paths are rooted in Git Bash's installation, not the Node drive.
    if (cleaned.startsWith("/") && !cleaned.startsWith("//")) return true;
  }
  if (!cleaned) return false;
  if (/[*?\[]/.test(cleaned)) {
    const normalizedToken = cleaned.replace(/\\/g, "/");
    const wildcard = normalizedToken.search(/[*?\[]/);
    const slash = normalizedToken.lastIndexOf("/");
    // Shell directory globs can traverse a junction we cannot resolve as one literal path.
    if (wildcard < slash) return true;
    const parent = resolve(cwd, slash < 0 ? "." : normalizedToken.slice(0, slash) || "/");
    const roots = [cwd, ...(allowedRoots ?? [])];
    if (!roots.some((r) => isPhysicallyInside(r, parent))) return true;
    try {
      // Conservatively inspect all possible final-component targets, including links not followed by readdir itself.
      return readdirSync(parent).some((name) => !roots.some((r) => isPhysicallyInside(r, join(parent, name))));
    } catch { return true; }
  }
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
  // Paths inside a read-only plugin root (skills/prompts/extensions/themes,
  // project .pi/*, installed packages) never escape the read sandbox.
  if (isInsideAnyRoot(abs, allowedRoots ?? [])) return false;
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
  return !isPhysicallyInside(root, abs);
}

/**
 * True when the command references a path outside the read sandbox — project
 * cwd, or any of the optional read-only roots (absolute escape, `..`, or
 * `git -C` / `--git-dir` / `--work-tree` outside).
 */
export function bashCommandEscapesCwd(
  command: string,
  cwd: string,
  allowedRoots?: readonly string[],
): boolean {
  const root = (cwd ?? "").trim();
  if (!root) return false;
  const cleaned = stripShellNoise(command);
  if (!cleaned) return false;

  const segments = tokenizeShellSegments(cleaned);
  if (!segments) return true;
  for (const tokens of segments) {
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const lower = tok.toLowerCase();
      // Long option values and attached short file options are still real filesystem arguments.
      const equalValue = tok.startsWith("-") && tok.includes("=") ? tok.slice(tok.indexOf("=") + 1) : null;
      const attachedPath = tokens[0] === "git" && /^-C.+/.test(tok) ? tok.slice(2)
        : ["grep", "rg", "ag", "ack", "jq", "yq"].includes(tokens[0]) && /^-[a-zA-Z]*[fL].+/.test(tok)
          ? tok.slice(tok.search(/[fL]/) + 1)
          : tokens[0] === "file" && /^-[a-zA-Z]*m.+/.test(tok) ? tok.slice(tok.indexOf("m") + 1) : null;
      const optionValue = equalValue ?? attachedPath;
      if (optionValue !== null) {
        // file's magic option accepts a list of paths; do not resolve that list as one harmless filename.
        if (tokens[0] === "file" && optionValue.includes(":") && !/^[a-z]:[^:]*$/i.test(optionValue)) return true;
        let optionTargetExists = false;
        try { lstatSync(resolve(root, optionValue)); optionTargetExists = true; }
        catch (err) { if (!["ENOENT", "ENOTDIR"].includes((err as NodeJS.ErrnoException).code ?? "")) return true; }
        if ((isPathLikeToken(optionValue) || optionTargetExists) && pathEscapesReadArea(root, optionValue, allowedRoots)) return true;
      }
      if (tokens[0] === "file" && !tok.startsWith("-") && tok.includes(":") && !/^[a-z]:[^:]*$/i.test(tok)) return true;
      if (
        lower === "-c" ||
        lower === "--git-dir" ||
        lower === "--work-tree" ||
        lower === "--prefix"
      ) {
        const next = tokens[i + 1];
        if (next && pathEscapesReadArea(root, next, allowedRoots)) return true;
        i += 1;
        continue;
      }
      let existingTarget = false;
      if (i > 0 && !tok.startsWith("-")) {
        try { lstatSync(resolve(root, unquote(tok))); existingTarget = true; }
        catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT" && (err as NodeJS.ErrnoException).code !== "ENOTDIR") return true; }
      }
      const fileGlob = i > 0 && /[*?\[]/.test(tok) && ["ls", "dir", "cat", "head", "tail", "stat", "file", "wc", "du"].includes(tokens[0].toLowerCase());
      if ((isPathLikeToken(tok) || existingTarget || fileGlob) && pathEscapesReadArea(root, tok, allowedRoots)) {
        return true;
      }
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

  const segments = tokenizeShellSegments(cleaned);
  if (!segments || segments.length === 0) return false;
  for (const tokens of segments) {
    const head = tokens[0].toLowerCase();
    if (!head || !READONLY_COMMAND_HEADS.has(head)) return false;
    if (hasUnsafeArguments(tokens)) return false;
    if (head === "git" && !isReadonlyGit(tokens)) return false;
  }
  return true;
}

export function readonlyBashBlockReason(command: string): string {
  return `调研/Plan 模式仅允许只读 bash（如 git status、ls、rg），且路径须在项目目录内。已拦截：${command.slice(0, 120)}`;
}

export function cwdEscapeBashBlockReason(command: string): string {
  return `调研/Plan 模式禁止 bash 访问项目目录外路径。已拦截：${command.slice(0, 120)}`;
}
