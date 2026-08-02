type ContentPart = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  args?: unknown;
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

/** Extract display text from a Pi message object (trimmed). */
export function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return textFromContent(content as ContentPart[], { trim: true });
}
