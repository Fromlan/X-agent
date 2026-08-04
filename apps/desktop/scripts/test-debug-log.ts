/**
 * Offline assertions for `shared/debug-log.ts`.
 *
 * Verifies that debug logging stays silent by default (so production users
 * see no noise) and that enabling the flag actually routes to console.log.
 */

import { dbgLog, dbgTimer, dbgWarn, isDebugEnabled } from "../shared/debug-log";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Replace a console method with a counting spy; return restore fn. */
function spy<K extends "log" | "warn">(method: K): { restore: () => void; calls: unknown[][] } {
  const original = console[method];
  const calls: unknown[][] = [];
  // eslint-disable-next-line no-console
  console[method] = (...args: unknown[]) => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      // eslint-disable-next-line no-console
      console[method] = original;
    },
  };
}

/** Save current flag values, restore in finally. */
function withEnv(
  envValue: string | undefined,
  storageValue: string | null,
  run: () => void,
): void {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const prevEnv = proc?.env?.X_AGENT_DEBUG;
  const g = globalThis as {
    localStorage?: {
      getItem(k: string): string | null;
      setItem(k: string, v: string): void;
      removeItem(k: string): void;
    };
  };
  const hadLs = typeof g.localStorage !== "undefined";
  const prevStorage = hadLs ? g.localStorage?.getItem("x-agent-debug") ?? null : null;
  if (!hadLs) {
    const store = new Map<string, string>();
    g.localStorage = {
      getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k, v) => {
        store.set(k, String(v));
      },
      removeItem: (k) => {
        store.delete(k);
      },
    };
  }
  if (proc?.env) {
    if (envValue === undefined) delete proc.env.X_AGENT_DEBUG;
    else proc.env.X_AGENT_DEBUG = envValue;
  }
  if (g.localStorage) {
    if (storageValue === null) g.localStorage.removeItem("x-agent-debug");
    else g.localStorage.setItem("x-agent-debug", storageValue);
  }
  try {
    run();
  } finally {
    if (proc?.env) {
      if (prevEnv === undefined) delete proc.env.X_AGENT_DEBUG;
      else proc.env.X_AGENT_DEBUG = prevEnv;
    }
    if (g.localStorage) {
      if (prevStorage === null) g.localStorage.removeItem("x-agent-debug");
      else g.localStorage.setItem("x-agent-debug", prevStorage);
    }
    if (!hadLs) delete g.localStorage;
  }
}

// Case 1: with no flag set, dbgLog / dbgWarn / dbgTimer are ON by default
// so users can diagnose chat-pipeline hangs without first flipping a switch.
withEnv(undefined, null, () => {
  const logSpy = spy("log");
  const warnSpy = spy("warn");
  try {
    assert(isDebugEnabled(), "isDebugEnabled() must default to true");
    dbgLog("test", "hello");
    dbgWarn("test", "watch out");
    const stop = dbgTimer("test", "phase");
    stop();
    assert(logSpy.calls.length === 2, "dbgLog + dbgTimer.end should each emit one log line");
    assert(warnSpy.calls.length === 1, "dbgWarn should emit one warn line");
  } finally {
    logSpy.restore();
    warnSpy.restore();
  }
});

// Case 2: explicit opt-out (env = "0") silences everything.
withEnv("0", null, () => {
  const logSpy = spy("log");
  const warnSpy = spy("warn");
  try {
    assert(!isDebugEnabled(), "X_AGENT_DEBUG=0 must disable logging");
    dbgLog("test", "hello");
    dbgWarn("test", "watch out");
    const stop = dbgTimer("test", "phase");
    stop();
    assert(logSpy.calls.length === 0, "dbgLog must no-op when disabled");
    assert(warnSpy.calls.length === 0, "dbgWarn must no-op when disabled");
  } finally {
    logSpy.restore();
    warnSpy.restore();
  }
});

// Case 3: opt-in via env also works; format is [x-agent][<ns>] <iso> <args>.
withEnv("1", null, () => {
  const logSpy = spy("log");
  const warnSpy = spy("warn");
  try {
    assert(isDebugEnabled(), "isDebugEnabled() must honour X_AGENT_DEBUG=1");
    dbgLog("alpha", "payload", { a: 1 });
    assert(logSpy.calls.length === 1, "dbgLog should print exactly once");
    const head = logSpy.calls[0]?.[0];
    assert(typeof head === "string", "log line should start with a string");
    assert(
      head.startsWith("[x-agent][alpha] "),
      `head must start with [x-agent][alpha], got: ${String(head)}`,
    );
    assert(
      // ISO timestamp portion (between namespace and payload) is 24 chars.
      /^\[x-agent\]\[alpha\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(head),
      `head should be "[x-agent][alpha] <ISO>", got: ${String(head)}`,
    );
    dbgWarn("beta", "x");
    assert(warnSpy.calls.length === 1, "dbgWarn should print to console.warn");
    const stop = dbgTimer("gamma", "step");
    stop();
    assert(
      logSpy.calls.length === 2,
      "dbgTimer end should produce exactly one console.log line",
    );
    const timerHead = logSpy.calls[1]?.[0];
    assert(
      typeof timerHead === "string" && timerHead.startsWith("[x-agent][gamma] "),
      "timer line must use the [gamma] namespace",
    );
    assert(
      typeof timerHead === "string" && /\+0ms$/.test(timerHead),
      "timer line must end with +<n>ms",
    );
  } finally {
    logSpy.restore();
    warnSpy.restore();
  }
});

// Case 4: opt-out via localStorage (renderer-style flag).
withEnv(undefined, "0", () => {
  assert(!isDebugEnabled(), "localStorage['x-agent-debug']='0' must disable logging");
});

// Case 5: truthy-but-non-1 env values still enable logging (case-insensitive).
withEnv("TRUE", null, () => {
  assert(isDebugEnabled(), "X_AGENT_DEBUG=TRUE must enable logging");
  const logSpy = spy("log");
  try {
    dbgLog("ns", "ok");
    assert(logSpy.calls.length === 1, "truthy env value must produce a log line");
  } finally {
    logSpy.restore();
  }
});

console.log("test-debug-log: ok");