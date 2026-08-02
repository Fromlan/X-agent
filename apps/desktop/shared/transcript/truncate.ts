import { TRANSCRIPT_CAPS } from "./caps";

/**
 * Stringify + slice with a Chinese truncation suffix.
 * Returns `{ value, truncated }` so callers can keep a flag or discard it.
 */
export function truncateSerialized(
  value: unknown,
  max: number = TRANSCRIPT_CAPS.default,
): { value: unknown; truncated: boolean } {
  try {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (!text) return { value, truncated: false };
    if (text.length <= max) {
      return { value, truncated: false };
    }
    return {
      value: `${text.slice(0, max)}\n…(截断 ${text.length - max} 字符)`,
      truncated: true,
    };
  } catch {
    return { value: String(value), truncated: false };
  }
}

/** Convenience: return truncated value only (history / stream path). */
export function truncateTranscript(
  value: unknown,
  max: number = TRANSCRIPT_CAPS.default,
): unknown {
  return truncateSerialized(value, max).value;
}
