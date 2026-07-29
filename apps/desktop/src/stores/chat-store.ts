import type { HistoryItem, UiAgentEvent } from "@shared/ipc";

export type ChatItem = HistoryItem;

export function createEmptyState(): ChatItem[] {
  return [];
}

/**
 * Defense-only: when streaming events omit userEntryId, derive from the
 * preceding user message. Prefer event / history_replace payloads.
 */
function findPrecedingUserEntryId(
  items: ChatItem[],
  beforeIndex: number,
): string | undefined {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const it = items[i];
    if (it && it.kind === "user") {
      return it.entryId ?? it.id;
    }
  }
  return undefined;
}

function upsertAssistant(
  items: ChatItem[],
  messageId: string,
  patch: Partial<Extract<ChatItem, { kind: "assistant" }>>,
): ChatItem[] {
  const idx = items.findIndex((i) => i.kind === "assistant" && i.id === messageId);
  if (idx === -1) {
    const userEntryId =
      patch.userEntryId ?? findPrecedingUserEntryId(items, items.length);
    return [
      ...items,
      {
        kind: "assistant",
        id: messageId,
        text: patch.text ?? "",
        thinking: patch.thinking ?? "",
        done: patch.done ?? false,
        isError: patch.isError,
        ...(patch.entryId ? { entryId: patch.entryId } : {}),
        ...(userEntryId ? { userEntryId } : {}),
      },
    ];
  }
  const current = items[idx] as Extract<ChatItem, { kind: "assistant" }>;
  const entryId = patch.entryId ?? current.entryId;
  const userEntryId =
    patch.userEntryId ??
    current.userEntryId ??
    findPrecedingUserEntryId(items, idx);
  const next = [...items];
  next[idx] = {
    ...current,
    ...patch,
    ...(entryId ? { entryId } : {}),
    ...(userEntryId ? { userEntryId } : {}),
  };
  return next;
}

export function applyAgentEvent(items: ChatItem[], event: UiAgentEvent): ChatItem[] {
  switch (event.type) {
    case "history_replace":
      return event.items;

    case "user_message": {
      const id = event.id ?? `user-${Date.now()}-${items.length}`;
      if (items.some((i) => i.kind === "user" && i.id === id)) {
        return items;
      }
      return [
        ...items,
        {
          kind: "user",
          id,
          text: event.text,
          ...(event.entryId ? { entryId: event.entryId } : {}),
        },
      ];
    }
    case "assistant_start":
      return upsertAssistant(items, event.messageId, {
        text: "",
        thinking: "",
        done: false,
        ...(event.userEntryId ? { userEntryId: event.userEntryId } : {}),
      });
    case "text_delta": {
      const prev = items.find(
        (i) => i.kind === "assistant" && i.id === event.messageId,
      ) as Extract<ChatItem, { kind: "assistant" }> | undefined;
      return upsertAssistant(items, event.messageId, {
        text: (prev?.text ?? "") + event.delta,
      });
    }
    case "thinking_delta": {
      const prev = items.find(
        (i) => i.kind === "assistant" && i.id === event.messageId,
      ) as Extract<ChatItem, { kind: "assistant" }> | undefined;
      return upsertAssistant(items, event.messageId, {
        thinking: (prev?.thinking ?? "") + event.delta,
      });
    }
    case "assistant_end":
      return upsertAssistant(items, event.messageId, {
        done: true,
        isError: event.isError,
        ...(event.errorMessage
          ? {
              text: (() => {
                const prev = items.find(
                  (i) => i.kind === "assistant" && i.id === event.messageId,
                ) as Extract<ChatItem, { kind: "assistant" }> | undefined;
                if (prev?.text) return prev.text;
                return event.errorMessage;
              })(),
            }
          : {}),
      });
    case "tool_start":
      return [
        ...items,
        {
          kind: "tool",
          id: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          done: false,
        },
      ];
    case "tool_update": {
      const idx = items.findIndex((i) => i.kind === "tool" && i.id === event.toolCallId);
      if (idx === -1) return items;
      const next = [...items];
      const cur = next[idx] as Extract<ChatItem, { kind: "tool" }>;
      next[idx] = { ...cur, result: event.partialResult };
      return next;
    }
    case "tool_end": {
      const idx = items.findIndex((i) => i.kind === "tool" && i.id === event.toolCallId);
      if (idx === -1) {
        return [
          ...items,
          {
            kind: "tool",
            id: event.toolCallId,
            toolName: event.toolName,
            args: undefined,
            result: event.result,
            isError: event.isError,
            done: true,
          },
        ];
      }
      const next = [...items];
      const cur = next[idx] as Extract<ChatItem, { kind: "tool" }>;
      next[idx] = {
        ...cur,
        result: event.result,
        isError: event.isError,
        done: true,
      };
      return next;
    }
    case "notice":
      return [
        ...items,
        {
          kind: "system",
          id: `notice-${Date.now()}-${items.length}`,
          text: event.text,
          level: event.level ?? "info",
        },
      ];
    case "auto_retry":
      if (event.phase === "start") {
        return [
          ...items,
          {
            kind: "system",
            id: `retry-${event.attempt}-${items.length}`,
            text: `自动重试 ${event.attempt}/${event.maxAttempts ?? "?"}：${event.message ?? ""}`,
            level: "warn",
          },
        ];
      }
      if (!event.success && event.message) {
        return [
          ...items,
          {
            kind: "system",
            id: `retry-fail-${event.attempt}-${items.length}`,
            text: `重试失败：${event.message}`,
            level: "error",
          },
        ];
      }
      return items;
    default:
      return items;
  }
}
