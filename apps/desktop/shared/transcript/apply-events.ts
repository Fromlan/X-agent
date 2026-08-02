import type { HistoryItem, UiAgentEvent } from "../ipc";

export type ChatItem = HistoryItem;

/** Optimistic user bubbles shown before Pi's user_message / history_replace. */
export const PENDING_USER_ID_PREFIX = "pending-user-";

export function createEmptyState(): ChatItem[] {
  return [];
}

export function makePendingUserId(): string {
  return `${PENDING_USER_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isPendingUserId(id: string): boolean {
  return id.startsWith(PENDING_USER_ID_PREFIX);
}

/** Append a local-only user bubble so the transcript updates on send. */
export function appendPendingUser(
  items: ChatItem[],
  text: string,
  id?: string,
): ChatItem[] {
  const pendingId = id ?? makePendingUserId();
  return [
    ...items,
    {
      kind: "user",
      id: pendingId,
      text,
    },
  ];
}

/** Drop a pending bubble (e.g. prompt IPC failed before the real event). */
export function removePendingUser(items: ChatItem[], id: string): ChatItem[] {
  if (!isPendingUserId(id)) return items;
  return items.filter((i) => !(i.kind === "user" && i.id === id));
}

/** Find the index of an assistant / tool item by id. Hot path callers first
 * check the tail (O(1)); this fallback only fires for non-trailing messageIds,
 * e.g. interleaved assistant streams. N is bounded by transcript size — for
 * typical sessions (≤ 200 entries) the linear scan is effectively constant. */
function indexOfById<T extends ChatItem & { id: string }>(
  items: ChatItem[],
  kind: T["kind"],
  id: string,
): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === kind && it.id === id) return i;
  }
  return -1;
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
  // Hot path: streaming deltas almost always target the trailing assistant.
  const last = items[items.length - 1];
  const idx =
    last?.kind === "assistant" && last.id === messageId
      ? items.length - 1
      : indexOfById(items, "assistant" as const, messageId);
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

/** Append a streaming text/thinking delta with O(1) tail lookup when possible. */
function appendAssistantDelta(
  items: ChatItem[],
  messageId: string,
  field: "text" | "thinking",
  delta: string,
): ChatItem[] {
  const last = items[items.length - 1];
  if (last?.kind === "assistant" && last.id === messageId) {
    const next = items.slice();
    next[items.length - 1] = {
      ...last,
      [field]: (last[field] ?? "") + delta,
    };
    return next;
  }
  const prev = indexOfById(items, "assistant" as const, messageId);
  const prevText = prev >= 0
    ? (items[prev] as Extract<ChatItem, { kind: "assistant" }>)[field] ?? ""
    : "";
  return upsertAssistant(items, messageId, {
    [field]: prevText + delta,
  });
}

export function applyAgentEvent(
  items: ChatItem[],
  event: UiAgentEvent,
): ChatItem[] {
  switch (event.type) {
    case "history_replace":
      return event.items;

    case "user_message": {
      const id = event.id ?? `user-${Date.now()}-${items.length}`;
      if (items.some((i) => i.kind === "user" && i.id === id)) {
        return items;
      }
      const nextItem: ChatItem = {
        kind: "user",
        id,
        text: event.text,
        ...(event.entryId ? { entryId: event.entryId } : {}),
      };
      // Replace the trailing optimistic bubble so we do not flash a duplicate.
      const last = items[items.length - 1];
      if (last?.kind === "user" && isPendingUserId(last.id)) {
        return [...items.slice(0, -1), nextItem];
      }
      return [...items, nextItem];
    }
    case "assistant_start":
      return upsertAssistant(items, event.messageId, {
        text: "",
        thinking: "",
        done: false,
        ...(event.userEntryId ? { userEntryId: event.userEntryId } : {}),
      });
    case "text_delta":
      return appendAssistantDelta(items, event.messageId, "text", event.delta);
    case "thinking_delta":
      return appendAssistantDelta(
        items,
        event.messageId,
        "thinking",
        event.delta,
      );
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
      const idx = indexOfById(items, "tool" as const, event.toolCallId);
      if (idx === -1) return items;
      const cur = items[idx] as Extract<ChatItem, { kind: "tool" }>;
      if (cur.done) return items;
      const next = [...items];
      next[idx] = { ...cur, result: event.partialResult };
      return next;
    }
    case "tool_end": {
      const idx = indexOfById(items, "tool" as const, event.toolCallId);
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
    case "notice": {
      const level = event.level ?? "info";
      const replaceKey = event.replaceKey;
      if (replaceKey) {
        const idx = items.findLastIndex(
          (i) => i.kind === "system" && i.replaceKey === replaceKey,
        );
        const nextItem: ChatItem = {
          kind: "system",
          id:
            idx >= 0 && items[idx]!.kind === "system"
              ? items[idx]!.id
              : `notice-${replaceKey}`,
          text: event.text,
          level,
          replaceKey,
        };
        if (idx >= 0) {
          const next = items.slice();
          next[idx] = nextItem;
          return next;
        }
        return [...items, nextItem];
      }
      return [
        ...items,
        {
          kind: "system",
          id: `notice-${Date.now()}-${items.length}`,
          text: event.text,
          level,
        },
      ];
    }
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
