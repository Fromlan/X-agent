import type { HistoryItem } from "../../shared/ipc";

type ContentPart = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  args?: unknown;
};

type AnyMessage = {
  role?: string;
  content?: string | ContentPart[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  timestamp?: number | string;
};

/** Minimal shape of a Pi session tree message entry. */
export type BranchMessageEntry = {
  type: string;
  id: string;
  message?: AnyMessage;
};

function truncate(value: unknown, max = 8000): unknown {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (!text) return value;
    if (text.length <= max) return value;
    return `${text.slice(0, max)}\n…(截断 ${text.length - max} 字符)`;
  } catch {
    return String(value);
  }
}

function textFromContent(content: string | ContentPart[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("");
}

function thinkingFromContent(content: string | ContentPart[] | undefined): string {
  if (!content || typeof content === "string") return "";
  return content
    .filter((p) => p.type === "thinking" && p.thinking)
    .map((p) => p.thinking!)
    .join("");
}

function toolResultText(msg: AnyMessage): unknown {
  const content = msg.content;
  if (!content) return "";
  if (typeof content === "string") return truncate(content);
  const text = textFromContent(content);
  return truncate(text || content);
}

function pushMessages(
  items: HistoryItem[],
  pendingTools: Map<string, number>,
  msg: AnyMessage,
  index: number,
  entryId?: string,
  lastUserEntryId?: string | null,
): string | null | undefined {
  const role = msg.role;
  const idBase = String(msg.timestamp ?? index);
  let nextLastUser = lastUserEntryId;

  if (role === "user") {
    const text = textFromContent(msg.content);
    if (!text.trim()) return nextLastUser;
    const id = entryId ?? `hist-user-${idBase}-${index}`;
    items.push({
      kind: "user",
      id,
      text,
      ...(entryId ? { entryId } : {}),
    });
    return entryId ?? id;
  }

  if (role === "assistant") {
    const content = msg.content;
    const thinking = thinkingFromContent(content);
    const text = textFromContent(content);
    const assistantId = entryId ?? `hist-asst-${idBase}-${index}`;

    if (
      text ||
      thinking ||
      (Array.isArray(content) && content.some((p) => p.type === "toolCall"))
    ) {
      items.push({
        kind: "assistant",
        id: assistantId,
        text,
        thinking,
        done: true,
        ...(entryId ? { entryId } : {}),
        ...(lastUserEntryId ? { userEntryId: lastUserEntryId } : {}),
      });
    }

    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type !== "toolCall") continue;
        const toolId = part.id ?? `tool-${idBase}-${items.length}`;
        const toolItem: HistoryItem = {
          kind: "tool",
          id: toolId,
          toolName: part.name ?? "tool",
          args: truncate(part.arguments ?? part.args, 4000),
          done: false,
        };
        pendingTools.set(toolId, items.length);
        items.push(toolItem);
      }
    }
    return nextLastUser;
  }

  if (role === "toolResult") {
    const toolId = msg.toolCallId ?? "";
    const idx = pendingTools.get(toolId);
    const result = toolResultText(msg);
    const isError = Boolean(msg.isError);
    if (idx != null) {
      const prev = items[idx];
      if (prev.kind === "tool") {
        items[idx] = {
          ...prev,
          result,
          isError,
          done: true,
          toolName: msg.toolName ?? prev.toolName,
        };
      }
      pendingTools.delete(toolId);
    } else {
      items.push({
        kind: "tool",
        id: toolId || `hist-tool-${idBase}-${index}`,
        toolName: msg.toolName ?? "tool",
        args: undefined,
        result,
        isError,
        done: true,
      });
    }
  }

  return nextLastUser;
}

/**
 * Convert Pi AgentSession.messages into UI history items.
 * Prefer {@link branchEntriesToHistory} when session entry ids are available.
 */
export function messagesToHistory(messages: readonly unknown[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  const pendingTools = new Map<string, number>();
  let lastUserEntryId: string | null = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as AnyMessage;
    const next = pushMessages(items, pendingTools, msg, i, undefined, lastUserEntryId);
    if (next !== undefined) lastUserEntryId = next ?? null;
  }

  for (const idx of pendingTools.values()) {
    const prev = items[idx];
    if (prev.kind === "tool") {
      items[idx] = { ...prev, done: true };
    }
  }

  return items;
}

/**
 * Map the active session branch (root → leaf) to UI history, attaching Pi entry ids.
 */
export function branchEntriesToHistory(
  entries: readonly BranchMessageEntry[],
): HistoryItem[] {
  const items: HistoryItem[] = [];
  const pendingTools = new Map<string, number>();
  let lastUserEntryId: string | null = null;
  let index = 0;

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message) continue;
    const next = pushMessages(
      items,
      pendingTools,
      entry.message,
      index,
      entry.id,
      lastUserEntryId,
    );
    if (next !== undefined) lastUserEntryId = next ?? null;
    index += 1;
  }

  for (const idx of pendingTools.values()) {
    const prev = items[idx];
    if (prev.kind === "tool") {
      items[idx] = { ...prev, done: true };
    }
  }

  return items;
}
