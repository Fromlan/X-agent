/** Pi-normalized input buckets are disjoint; output is never part of a prompt. */
export type PromptTokenUsage = {
  input: number;
  cacheRead: number;
  cacheWrite?: number;
};

/** Reject non-finite counters so malformed usage cannot poison ratios or UI. */
function tokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

/** Restore complete input from Pi's uncached, cache-read and cache-write buckets. */
export function promptInputTokens(tokens: PromptTokenUsage): number {
  return tokenCount(tokens.input) + tokenCount(tokens.cacheRead) + tokenCount(tokens.cacheWrite);
}

/** Token-weighted cache-read ratio; cache writes consume input but are not hits. */
export function cacheHitRatio(tokens: PromptTokenUsage): number | null {
  const denom = promptInputTokens(tokens);
  if (denom <= 0) return null;
  return tokenCount(tokens.cacheRead) / denom;
}

/** Format a hit ratio as a percent string, or "—" when unknown. */
export function formatCacheHitRatio(ratio: number | null | undefined): string {
  if (ratio == null || Number.isNaN(ratio)) return "—";
  const pct = ratio * 100;
  return `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`;
}
