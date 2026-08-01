import type { ChatItem } from "../stores/chat-store";

/** Whether an item should occupy a transcript row (skip empty thinking-only shells). */
export function isDisplayableTranscriptItem(
  item: ChatItem,
  showThinking: boolean,
): boolean {
  if (item.kind !== "assistant") return true;
  const hasThinking = Boolean(showThinking && item.thinking);
  return hasThinking || Boolean(item.text.trim());
}
