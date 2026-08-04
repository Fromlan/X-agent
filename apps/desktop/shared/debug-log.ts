/**
 * Cross-process debug logger shared by Electron main and renderer.
 *
 * Built specifically for diagnosing chat-pipeline hangs (e.g. "user clicks
 * send but nothing happens"). Every entry is prefixed with `[x-agent][<ns>]`
 * plus an ISO timestamp, so the same line can be correlated across both
 * processes — main prints to the terminal stdout, renderer prints to the
 * DevTools console.
 *
 * On by default; opt out with one of:
 *   - Main:    set `X_AGENT_DEBUG=0` (or `false` / `no`) before launch.
 *   - Renderer: in DevTools console run
 *                  localStorage.setItem("x-agent-debug", "0")
 *              then reload, or set it before the renderer bundle runs.
 *
 * Use `dbgLog()` for ordinary traces, `dbgWarn()` for recoverable anomalies,
 * and `dbgTimer()` to measure how long an awaited step took.
 */
const PREFIX = "[x-agent]";

function parseFlag(raw: string | null | undefined): boolean | undefined {
  if (raw === null || raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "") return undefined;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return undefined;
}

/** Read main-process env flag. Guarded so renderer / SSR can't blow up. */
function readEnvFlag(): boolean | undefined {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process;
    if (!proc?.env) return undefined;
    return parseFlag(proc.env.X_AGENT_DEBUG);
  } catch {
    return undefined;
  }
}

/** Read renderer-process localStorage flag without throwing in sandboxed contexts. */
function readStorageFlag(): boolean | undefined {
  try {
    const ls = (globalThis as { localStorage?: { getItem(k: string): string | null } })
      .localStorage;
    if (!ls) return undefined;
    return parseFlag(ls.getItem("x-agent-debug"));
  } catch {
    return undefined;
  }
}

/** Whether debug logging is currently on in this process. Defaults to ON. */
export function isDebugEnabled(): boolean {
  const env = readEnvFlag();
  if (env !== undefined) return env;
  const storage = readStorageFlag();
  if (storage !== undefined) return storage;
  return true;
}

/** ISO timestamp — shared format so main and renderer lines line up. */
function ts(): string {
  return new Date().toISOString();
}

function fmt(ns: string, args: unknown[]): unknown[] {
  return [`${PREFIX}[${ns}] ${ts()}`, ...args];
}

/** Emit a trace-level debug entry. No-op when debug logging is disabled. */
export function dbgLog(ns: string, ...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.log(...fmt(ns, args));
}

/** Emit a warn-level debug entry. Still gated by the debug flag. */
export function dbgWarn(ns: string, ...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.warn(...fmt(ns, args));
}

/**
 * Start a labelled timer; the returned function logs elapsed milliseconds
 * since this call. Useful for diagnosing where an awaited step is hanging.
 */
export function dbgTimer(ns: string, label: string): () => void {
  if (!isDebugEnabled()) return () => undefined;
  const start = Date.now();
  return () => {
    // eslint-disable-next-line no-console
    console.log(`${PREFIX}[${ns}] ${ts()} ${label} +${Date.now() - start}ms`);
  };
}