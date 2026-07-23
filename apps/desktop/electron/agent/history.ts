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

/**
 * Convert Pi AgentSession.messages into UI history items.
 */
export function messagesToHistory(messages: readonly unknown[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  const pendingTools = new Map<string, number>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as AnyMessage;
    const role = msg.role;
    const idBase = String(msg.timestamp ?? i);

    if (role === "user") {
      const text = textFromContent(msg.content);
      if (!text.trim()) continue;
      items.push({ kind: "user", id: `hist-user-${idBase}-${i}`, text });
      continue;
    }

    if (role === "assistant") {
      const content = msg.content;
      const thinking = thinkingFromContent(content);
      const text = textFromContent(content);
      const assistantId = `hist-asst-${idBase}-${i}`;

      // Emit assistant bubble first (even if only tools)
      if (text || thinking || (Array.isArray(content) && content.some((p) => p.type === "toolCall"))) {
        items.push({
          kind: "assistant",
          id: assistantId,
          text,
          thinking,
          done: true,
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
      continue;
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
          id: toolId || `hist-tool-${idBase}-${i}`,
          toolName: msg.toolName ?? "tool",
          args: undefined,
          result,
          isError,
          done: true,
        });
      }
    }
  }

  // Mark any unresolved tools as done without result
  for (const idx of pendingTools.values()) {
    const prev = items[idx];
    if (prev.kind === "tool") {
      items[idx] = { ...prev, done: true };
    }
  }

  return items;
}
