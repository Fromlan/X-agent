import type { HistoryItem } from "../ipc";

/** Whether an item should occupy a transcript row (skip empty thinking-only shells). */
export function isDisplayableTranscriptItem(
  item: HistoryItem,
  showThinking: boolean,
): boolean {
  if (item.kind !== "assistant") return true;
  const hasThinking = Boolean(showThinking && item.thinking);
  return hasThinking || Boolean(item.text.trim());
}
