import { translateError } from "../error-i18n";

/**
 * Format an upstream error string for display inside an assistant bubble.
 *
 * Returns a markdown snippet: a Chinese summary on top, then the raw
 * payload inside a fenced code block so it stays selectable / copyable
 * for support tickets. Avoids raw HTML (`<details>`) because the renderer
 * uses react-markdown without `rehype-raw`, which would otherwise print
 * the tags as literal text.
 *
 * Used by both `apply-events.ts` (live assistant_end events) and
 * `branch-mapper.ts` (history_replace after restart / cross-session
 * restore) so an auth failure looks identical whether the user just sent
 * the message or came back to an old session.
 */
export function formatErrorBubble(raw: string): string {
  const summary = translateError(raw);
  const trimmed = raw.trim();
  // Short / already-friendly messages don't need a code block — keep it inline.
  if (trimmed.length === 0 || trimmed === summary) return summary;
  return `${summary}\n\n**原始错误：**\n\n\`\`\`\n${trimmed}\n\`\`\``;
}