/**
 * Auto-maintain: snip stale tool results first, then compact if still over.
 *
 * Insipred by `esengine/DeepSeek-Reasonix` SPEC section 3.6:
 *   "stale tool output is snipped/pruned before summary compaction"
 *
 * Flow:
 *   1. If `prefs.autoCompactPercent` is `0`, auto-maintain is disabled.
 *   2. `getContextUsage().percent >= autoCompactPercent` is the sole trigger.
 *   3. Phase 1: `snipToolResultsInPlace` on `session.messages`. Re-check percent.
 *   4. If snip alone cleared pressure, return early. No summary call.
 *   5. Phase 2: `session.compact()`. The compaction summary itself is a fresh
 *      LLM call; we let Pi's existing `isCompacting` lock serialize this.
 *
 * Concurrency:
 *   - Single-flight: a `pending` flag stops overlapping executions; the
 *     `runReplaceExclusive` wrapper from `session-host.ts` enforces the
 *     "no compact while user is mid-stream" rule at the call site.
 *   - Debounce: a 5s minimum gap between two auto-maintain runs (in-session).
 *   - The snip pass is pure local mutation and does not need the lock.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ClientPrefs } from "../../shared/ipc";
import {
  snipToolResultsInPlace,
  type SnipOptions,
  type SnipReport,
} from "./snip-tool-result";

/** Minimum gap between two auto-maintain runs (ms). */
export const AUTO_MAINTAIN_DEBOUNCE_MS = 5_000;

/** Snip alone is considered "cleared" when percent drops below this. */
export const AUTO_MAINTAIN_CLEAR_FACTOR = 0.7;

export type AutoMaintainOutcome =
  | "disabled"
  | "below-threshold"
  | "no-context-info"
  | "session-busy"
  | "debounced"
  | "snip-cleared"
  | "compacted"
  | "snipped-and-compacted"
  | "snip-only"
  | "compact-failed"
  | "noop";

export type AutoMaintainReport = {
  outcome: AutoMaintainOutcome;
  percentBefore: number | null;
  percentAfter: number | null;
  snip: SnipReport;
  /** Tokens freed by compaction, when the compact step ran. */
  compactFreedTokens?: number;
  /** Why a snip was not enough / why compact failed. */
  detail?: string;
};

export type AutoMaintainDeps = {
  /** Wall clock; injectable for tests. */
  now?: () => number;
  /** Source of `lastAutoMaintainAt`; defaults to a module-level variable. */
  getLastRunAt?: () => number;
  setLastRunAt?: (at: number) => void;
  /** Logger for snip stats; receives a one-line summary on every run. */
  log?: (line: string) => void;
};

const moduleState: { lastRunAt: number } = { lastRunAt: 0 };

/** Reset the in-process debounce clock. Tests only. */
export function __resetAutoMaintainState(): void {
  moduleState.lastRunAt = 0;
}

/** Read percent / tokens from a Pi session, tolerating any thrown shape. */
function readContextUsage(
  session: AgentSession,
): { percent: number; tokens: number; contextWindow: number } | null {
  try {
    const u = session.getContextUsage();
    if (!u) return null;
    const win = u.contextWindow;
    if (!win || win <= 0) return null;
    const tokens = Number(u.tokens) || 0;
    const percent = (tokens / win) * 100;
    return { percent, tokens, contextWindow: win };
  } catch {
    return null;
  }
}

/**
 * Run the snip-first auto-maintain pass. Designed to be called by
 * `session-event-bridge` on `turn_end` and on every Nth `tool_execution_end`.
 *
 * Returns a report describing what happened. Never throws — failures inside
 * `session.compact()` are reported via `outcome: "compact-failed"` and
 * logged; the host keeps running.
 */
export async function autoMaintain(
  session: AgentSession,
  prefs: Pick<
    ClientPrefs,
    "autoCompactPercent" | "autoSnipThreshold" | "autoSnipHeadKeep" | "autoSnipTailKeep"
  >,
  deps: AutoMaintainDeps = {},
): Promise<AutoMaintainReport> {
  const now = deps.now ?? (() => Date.now());
  const getLast = deps.getLastRunAt ?? (() => moduleState.lastRunAt);
  const setLast = deps.setLastRunAt ?? ((at: number) => {
    moduleState.lastRunAt = at;
  });
  const log = deps.log ?? (() => {});

  // 0. disabled → done
  if (!prefs.autoCompactPercent || prefs.autoCompactPercent <= 0) {
    return {
      outcome: "disabled",
      percentBefore: null,
      percentAfter: null,
      snip: { snippedCount: 0, charsPruned: 0 },
    };
  }

  // 1. debounce
  if (now() - getLast() < AUTO_MAINTAIN_DEBOUNCE_MS) {
    return {
      outcome: "debounced",
      percentBefore: null,
      percentAfter: null,
      snip: { snippedCount: 0, charsPruned: 0 },
    };
  }

  // 2. read percent
  const before = readContextUsage(session);
  if (!before) {
    return {
      outcome: "no-context-info",
      percentBefore: null,
      percentAfter: null,
      snip: { snippedCount: 0, charsPruned: 0 },
    };
  }
  if (before.percent < prefs.autoCompactPercent) {
    return {
      outcome: "below-threshold",
      percentBefore: before.percent,
      percentAfter: before.percent,
      snip: { snippedCount: 0, charsPruned: 0 },
    };
  }

  setLast(now());

  // 3. snip first
  let snip: SnipReport = { snippedCount: 0, charsPruned: 0 };
  if (prefs.autoSnipThreshold > 0) {
    const messages = (session as unknown as { messages?: unknown[] }).messages;
    if (Array.isArray(messages)) {
      const snipOpts: SnipOptions = {
        threshold: prefs.autoSnipThreshold,
        headKeep: prefs.autoSnipHeadKeep,
        tailKeep: prefs.autoSnipTailKeep,
      };
      try {
        snip = snipToolResultsInPlace(messages, snipOpts, now());
      } catch (err) {
        log(
          `auto-maintain: snip threw (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
  }
  if (snip.snippedCount > 0) {
    log(
      `auto-maintain: snipped ${snip.snippedCount} tool result(s); freed ~${snip.charsPruned} chars`,
    );
  }

  // 4. re-check percent
  const mid = readContextUsage(session);
  const percentAfterSnip = mid?.percent ?? before.percent;
  const clearThreshold = prefs.autoCompactPercent * AUTO_MAINTAIN_CLEAR_FACTOR;
  if (percentAfterSnip < clearThreshold) {
    return {
      outcome: snip.snippedCount > 0 ? "snip-cleared" : "noop",
      percentBefore: before.percent,
      percentAfter: percentAfterSnip,
      snip,
    };
  }

  // 5. compact if still over
  if (session.isCompacting) {
    return {
      outcome: "session-busy",
      percentBefore: before.percent,
      percentAfter: percentAfterSnip,
      snip,
    };
  }

  let tokensBefore: number | undefined;
  let tokensAfter: number | undefined;
  try {
    const result = await session.compact();
    tokensBefore = result.tokensBefore;
    tokensAfter = result.estimatedTokensAfter;
  } catch (err) {
    log(
      `auto-maintain: compact failed (${err instanceof Error ? err.message : String(err)})`,
    );
    return {
      outcome: "compact-failed",
      percentBefore: before.percent,
      percentAfter: percentAfterSnip,
      snip,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const after = readContextUsage(session);
  const outcome: AutoMaintainOutcome = snip.snippedCount > 0
    ? "snipped-and-compacted"
    : "compacted";
  return {
    outcome,
    percentBefore: before.percent,
    percentAfter: after?.percent ?? percentAfterSnip,
    snip,
    compactFreedTokens:
      typeof tokensBefore === "number" && typeof tokensAfter === "number"
        ? Math.max(0, tokensBefore - tokensAfter)
        : undefined,
  };
}
