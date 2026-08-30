import type { HistoryItem, ImageContent } from "../ipc";
import { TRANSCRIPT_CAPS } from "./caps";
import { imagesFromContent, textFromContent, thinkingFromContent } from "./content";
import { truncateTranscript } from "./truncate";
import { formatErrorBubble } from "./error-format";

type ContentPart = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  args?: unknown;
};

export type TranscriptMessage = {
  role?: string;
  content?: string | ContentPart[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  /** Upstream failure text (auth error, network drop, context overflow). */
  errorMessage?: string;
  timestamp?: number | string;
};

/** Minimal shape of a Pi session tree message entry. */
export type BranchMessageEntry = {
  type: string;
  id: string;
  message?: TranscriptMessage;
};

function toolResultText(msg: TranscriptMessage): unknown {
  const content = msg.content;
  if (!content) return "";
  if (typeof content === "string") return truncateTranscript(content);
  const text = textFromContent(content);
  return truncateTranscript(text || content);
}

function pushMessages(
  items: HistoryItem[],
  pendingTools: Map<string, number>,
  msg: TranscriptMessage,
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
    // 提取 image content blocks — turn_end 后 history_replace 会用这里
    // 出来的 items 整体替换 in-memory list (#42 修复 #2:appendPendingUser
    // 写入的 images 会被这步擦掉)。从 Pi SDK 的 user message content
    // 里把 image 块拎出来,UserBubble 才能在 reload / 后续 turn 继续
    // 看到已附图。空数组不写字段(避免持久化噪声)。
    const images: ImageContent[] = imagesFromContent(msg.content);
    items.push({
      kind: "user",
      id,
      text,
      ...(entryId ? { entryId } : {}),
      ...(images.length > 0 ? { images } : {}),
    });
    return entryId ?? id;
  }

  if (role === "assistant") {
    const content = msg.content;
    const thinking = thinkingFromContent(content);
    const text = textFromContent(content);
    const assistantId = entryId ?? `hist-asst-${idBase}-${index}`;
    // An upstream error (auth failure, network drop, context overflow) often
    // produces an assistant message with empty content but a populated
    // `errorMessage`. Without this branch, branch-mapper drops it and the
    // subsequent history_replace silently erases the error bubble the user
    // briefly saw — making failures look like "no response".
    const errorText =
      typeof msg.errorMessage === "string" && msg.errorMessage.length > 0
        ? msg.errorMessage
        : "";
    const hasToolCall =
      Array.isArray(content) && content.some((p) => p.type === "toolCall");

    if (text || thinking || errorText || hasToolCall) {
      items.push({
        kind: "assistant",
        id: assistantId,
        // Error assistants get the same markdown summary + <details> block
        // the live event path emits, so an old session restored via
        // history_replace looks identical to a fresh failure.
        text: errorText ? formatErrorBubble(errorText) : text,
        thinking,
        done: true,
        isError: Boolean(errorText) || Boolean(msg.isError),
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
          args: truncateTranscript(
            part.arguments ?? part.args,
            TRANSCRIPT_CAPS.toolArgs,
          ),
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

function finalizePendingTools(
  items: HistoryItem[],
  pendingTools: Map<string, number>,
): void {
  for (const idx of pendingTools.values()) {
    const prev = items[idx];
    if (prev.kind === "tool") {
      items[idx] = { ...prev, done: true };
    }
  }
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

  finalizePendingTools(items, pendingTools);
  return items;
}
