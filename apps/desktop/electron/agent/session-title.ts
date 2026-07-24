/**
 * Derive a short display title from conversation text.
 * Used for auto-naming sessions after the first completed round.
 */

export const DEFAULT_TITLE = "新对话";

function collapseWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t\f\v]+/g, " ").trim();
}

/**
 * Strip Fleet pair role banners so auto-titles use the real task text.
 * e.g. "【Fleet 角色：实现槽 / worker】\n任务：…" → "…"
 */
export function stripFleetRoleWrapper(text: string): string {
  const matched = text.match(/^【Fleet 角色：[^\]]*】\s*/u);
  if (!matched) return text.trim();
  return text.slice(matched[0].length).replace(/^任务：\s*/u, "").trim();
}

function stripNoise(text: string): string {
  return collapseWhitespace(
    stripFleetRoleWrapper(text)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`\n]+`/g, " ")
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
      .replace(/^#+\s+/gm, "")
      .replace(/^>\s+/gm, ""),
  );
}

/**
 * Truncate to a title-sized string, preferring punctuation / space breaks.
 */
export function truncateTitle(text: string, maxLen = 36): string {
  const cleaned = stripNoise(text);
  if (!cleaned) return "";

  const firstLine = cleaned.split("\n").find((l) => l.trim()) ?? cleaned;
  const line = collapseWhitespace(firstLine);
  if (line.length <= maxLen) return line;

  const slice = line.slice(0, maxLen);
  const softBreaks = ["。", "！", "？", ".", "!", "?"];
  const weakBreaks = ["，", "、", ",", ";", " "];

  for (const ch of softBreaks) {
    const idx = slice.lastIndexOf(ch);
    if (idx >= Math.floor(maxLen * 0.4)) {
      return slice.slice(0, idx + 1).trim();
    }
  }
  for (const ch of weakBreaks) {
    const idx = slice.lastIndexOf(ch);
    if (idx >= Math.floor(maxLen * 0.45)) {
      return `${slice.slice(0, idx).trim()}…`;
    }
  }
  return `${slice.trim()}…`;
}

/**
 * Build a session title from the first user message (and optional assistant reply).
 */
export function deriveSessionTitle(
  userText: string,
  assistantText?: string,
  maxLen = 36,
): string {
  const user = stripNoise(userText);
  const assistant = assistantText ? stripNoise(assistantText) : "";

  if (user.length >= 8) {
    return truncateTitle(user, maxLen) || DEFAULT_TITLE;
  }

  if (user && assistant) {
    return truncateTitle(`${user} — ${assistant}`, maxLen) || DEFAULT_TITLE;
  }

  if (user) return truncateTitle(user, maxLen) || DEFAULT_TITLE;
  if (assistant) return truncateTitle(assistant, maxLen) || DEFAULT_TITLE;
  return DEFAULT_TITLE;
}

export function displaySessionName(
  name: string | undefined,
  firstMessage?: string,
): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  if (firstMessage?.trim()) {
    const derived = truncateTitle(firstMessage, 36);
    if (derived) return derived;
  }
  return DEFAULT_TITLE;
}
