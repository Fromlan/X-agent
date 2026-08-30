type ContentPart = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  args?: unknown;
  /** Image content block (Pi SDK `ImageContent` shape). */
  data?: string;
  mimeType?: string;
};

export type TranscriptContentPart = ContentPart;

export function textFromContent(
  content: string | ContentPart[] | undefined,
  options?: { trim?: boolean },
): string {
  if (!content) return "";
  let text: string;
  if (typeof content === "string") {
    text = content;
  } else {
    text = content
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("");
  }
  return options?.trim ? text.trim() : text;
}

export function thinkingFromContent(
  content: string | ContentPart[] | undefined,
): string {
  if (!content || typeof content === "string") return "";
  return content
    .filter((p) => p.type === "thinking" && p.thinking)
    .map((p) => p.thinking!)
    .join("");
}

/**
 * Extract image attachments from a Pi message content array.
 *
 * Used by `branch-mapper.ts` to keep `HistoryItem.user.images` populated
 * after `history_replace` fires (#42 修复 #2:之前只取 text,image content
 * block 被丢,user bubble 显示后又被 history_replace 替换成纯文本)。
 *
 * 字段与 `shared/ipc.ts:ImageContent` 对齐 (`type: "image"` / `data` 是
 * base64 body,不带 `data:` 前缀 / `mimeType`)。Pi SDK 的 content block
 * 字段叫 `data`(base64) + `mimeType`,正好兼容。
 */
export function imagesFromContent(
  content: string | ContentPart[] | undefined,
): { type: "image"; data: string; mimeType: string }[] {
  if (!content || typeof content === "string") return [];
  return content
    .filter(
      (p): p is ContentPart & { data: string; mimeType: string } =>
        p.type === "image" &&
        typeof p.data === "string" &&
        p.data.length > 0 &&
        typeof p.mimeType === "string" &&
        p.mimeType.length > 0,
    )
    .map((p) => ({
      type: "image",
      data: p.data,
      mimeType: p.mimeType,
    }));
}

/** Extract display text from a Pi message object (trimmed). */
export function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return textFromContent(content as ContentPart[], { trim: true });
}
