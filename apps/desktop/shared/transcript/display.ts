import type { HistoryItem } from "../ipc";

/**
 * Whether an item should occupy a transcript row.
 *
 * Empty thinking-only assistant shells are normally hidden so the chat
 * doesn't fill with phantom placeholders. Error assistants are exempt —
 * even an empty-text error bubble carries information the user must see
 * (e.g. a 401 auth failure with no model output at all).
 */
export function isDisplayableTranscriptItem(
  item: HistoryItem,
  showThinking: boolean,
): boolean {
  if (item.kind !== "assistant") return true;
  if (item.isError) return true;
  const hasThinking = Boolean(showThinking && item.thinking);
  return hasThinking || Boolean(item.text.trim());
}
