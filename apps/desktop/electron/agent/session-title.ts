/**
 * Session title helpers: local truncate fallback + isolated model-summary prompt.
 *
 * The model title call must stay a bare completeSimple Context: no agent system
 * prompt, no skills, no tools — only the title task + dialogue excerpt.
 */

export const DEFAULT_TITLE = "新对话";

/** Single-task instruction for the isolated title request (no agent persona). */
export const TITLE_SUMMARY_INSTRUCTION =
  `用不超过20个字总结下列对话的主题作为标题。只输出标题本身，不要引号和解释；若只是寒暄则输出「${DEFAULT_TITLE}」。`;

const EXCERPT_MAX = 600;

function collapseWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t\f\v]+/g, " ").trim();
}

function stripNoise(text: string): string {
  return collapseWhitespace(
    text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`\n]+`/g, " ")
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
      .replace(/^#+\s+/gm, "")
      .replace(/^>\s+/gm, ""),
  );
}

function clipExcerpt(text: string, max = EXCERPT_MAX): string {
  const cleaned = stripNoise(text);
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trim()}…`;
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
 * Used as fallback when the model summary request fails.
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

/**
 * Sole user message for the isolated title request.
 * No agent system prompt / tools — instruction + dialogue excerpt only.
 */
export function buildTitleSummaryPrompt(
  userText: string,
  assistantText?: string,
): string {
  const user = clipExcerpt(userText) || "(空)";
  const assistant = clipExcerpt(assistantText ?? "") || "(尚无回复)";
  return `${TITLE_SUMMARY_INSTRUCTION}\n\n用户：${user}\n助手：${assistant}`;
}

/**
 * Normalize model output into a single-line sidebar title.
 */
export function sanitizeModelTitle(raw: string, maxLen = 36): string {
  let text = stripNoise(raw);
  if (!text) return "";

  // Drop common wrappers / labels the model may prepend.
  text = text
    .replace(/^(标题|会话标题|title)\s*[:：]\s*/i, "")
    .replace(/^["'`「『“]+/, "")
    .replace(/["'`」』”]+$/, "")
    .replace(/[。.!！？?]+$/u, "")
    .trim();

  if (!text) return "";
  // Reject overly long dumps / multi-sentence answers.
  if (text.includes("\n")) {
    text = text.split("\n").find((l) => l.trim())?.trim() ?? text;
  }
  return truncateTitle(text, maxLen);
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

export type EnsureSessionTitleInput = {
  currentName?: string | null;
  userText: string;
  assistantText?: string;
  /** Returns raw model text, or null to keep local fallback. */
  complete?: (prompt: string) => Promise<string | null>;
  /** Abort after awaits if session changed / already named. */
  isStale?: () => boolean;
};

export type EnsureSessionTitleResult =
  | { action: "skip" }
  | { action: "set"; title: string; source: "model" | "fallback" };

/**
 * Ensure a session gets a title: skip-if-named, optional model summary, local fallback.
 */
export async function ensureSessionTitle(
  input: EnsureSessionTitleInput,
): Promise<EnsureSessionTitleResult | null> {
  if (input.currentName?.trim()) return { action: "skip" };
  if (!input.userText.trim() && !(input.assistantText ?? "").trim()) {
    return null;
  }

  const fallback = deriveSessionTitle(input.userText, input.assistantText);
  let title = fallback;
  let source: "model" | "fallback" = "fallback";

  if (input.complete) {
    try {
      if (input.isStale?.()) return null;
      const raw = await input.complete(
        buildTitleSummaryPrompt(input.userText, input.assistantText),
      );
      if (input.isStale?.()) return null;
      if (raw) {
        const sanitized = sanitizeModelTitle(raw);
        if (sanitized) {
          title = sanitized;
          source = "model";
        }
      }
    } catch {
      // Keep fallback.
    }
  }

  if (input.isStale?.()) return null;
  if (!title.trim()) title = DEFAULT_TITLE;
  return { action: "set", title, source };
}
