/**
 * DeepSeek-style prefix-cache hit ratio from prompt-side token counts.
 *
 * Pi maps `prompt_cache_hit_tokens` → `cacheRead` and stores non-cached prompt
 * tokens in `input`. Ratio = cacheRead / (input + cacheRead).
 * Returns null when there is no prompt-side usage yet.
 */
export function cacheHitRatio(tokens: {
  input: number;
  cacheRead: number;
}): number | null {
  const input = Math.max(0, Math.round(Number(tokens.input) || 0));
  const cacheRead = Math.max(0, Math.round(Number(tokens.cacheRead) || 0));
  const denom = input + cacheRead;
  if (denom <= 0) return null;
  return cacheRead / denom;
}

/** Format a hit ratio as a percent string, or "—" when unknown. */
export function formatCacheHitRatio(ratio: number | null | undefined): string {
  if (ratio == null || Number.isNaN(ratio)) return "—";
  const pct = ratio * 100;
  return `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`;
}
