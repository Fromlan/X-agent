/**
 * Parse Plan-mode clarifying multiple-choice blocks from assistant text.
 *
 * Expected format (emitted by Plan system prompt):
 *
 * <clarify>
 * Q: What renderer?
 * - Forward+
 * - Mobile
 * - Either
 * </clarify>
 */

export type ClarifyQuestion = {
  question: string;
  options: string[];
};

const CLARIFY_RE =
  /<clarify>\s*([\s\S]*?)\s*<\/clarify>/gi;

export function parseClarifyBlocks(text: string): ClarifyQuestion[] {
  if (!text || !text.includes("<clarify")) return [];
  const out: ClarifyQuestion[] = [];
  CLARIFY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLARIFY_RE.exec(text)) !== null) {
    const body = match[1] ?? "";
    const lines = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let question = "";
    const options: string[] = [];
    for (const line of lines) {
      const q = line.match(/^Q:\s*(.+)$/i);
      if (q) {
        question = q[1].trim();
        continue;
      }
      const opt =
        line.match(/^[-*+]\s+(.+)$/) ||
        line.match(/^\d+[.)]\s+(.+)$/) ||
        line.match(/^[a-zA-Z][.)]\s+(.+)$/);
      if (opt) {
        options.push(opt[1].trim());
      }
    }
    if (question && options.length >= 2) {
      out.push({ question, options });
    }
  }
  return out;
}

/** Format a user reply from selected options (one question → one answer line). */
export function formatClarifyReply(
  selections: Array<{ question: string; option: string }>,
): string {
  return selections
    .map((s) => `${s.question}\n→ ${s.option}`)
    .join("\n\n");
}
