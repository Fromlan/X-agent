/**
 * Parse Plan-mode clarifying multiple-choice blocks from assistant text.
 *
 * Supports two layouts the model may emit:
 *
 * (1) Multi-line:
 *     <clarify>
 *     Q: What renderer?
 *     - Forward+
 *     - Mobile
 *     - Either
 *     </clarify>
 *
 * (2) Inline (single line, common when LLM emits compact replies):
 *     <clarify> Q1: question - 选项 A: opt - 选项 B: opt - 选项 C: opt </clarify>
 *
 * `parseClarifyBlocks` dispatches by presence of newlines in the body;
 * both branches produce the same ClarifyQuestion shape.
 */

export type ClarifyQuestion = {
  question: string;
  options: string[];
};

const CLARIFY_RE = /<clarify>\s*([\s\S]*?)\s*<\/clarify>/gi;

/**
 * 多行 clarify 解析:每个 Q 行开启一个新问题,其后的选项行归属该问题,
 * 直到下一个 Q 行。支持 `- A: xxx` / `A: xxx` / `1. xxx` 等行首前缀。
 * 选项文本统一剥掉 `选项 X:` / `X:` / `X.` / `X)` 前缀(与内联分支一致)。
 */
function parseMultilineBlocks(body: string): ClarifyQuestion[] {
  const lines = body
    .split(/\r?\n/)
    .map((l: string) => l.trim())
    .filter(Boolean);
  const questions: ClarifyQuestion[] = [];
  let current: ClarifyQuestion | null = null;
  for (const line of lines) {
    const q = line.match(/^Q\d*\s*[:：]\s*(.+)$/i);
    if (q) {
      current = { question: q[1].trim(), options: [] };
      questions.push(current);
      continue;
    }
    if (!current) continue;
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    let text = bullet ? bullet[1].trim() : line;
    const label = text.match(/^(?:选项\s+)?[A-Za-z\d]+\s*[:：.)]\s*(.+)$/);
    if (label) text = label[1].trim();
    current.options.push(text);
  }
  return questions.filter((q) => q.options.length >= 2);
}

/**
 * 单行内联 clarify 解析:body 由` - ` 分隔成多段,
 *   - 第一段必须是 Q\d*(:|：) 开头,作为问题;
 *   - 剩余每段剥掉`选项 X:` / `X:` / `X)` 前缀作为选项;
 *   - 剥不掉前缀的整段保留为选项文本(兜底)。
 *
 * 全角冒号`：`、全角右括号也通过字符类一并覆盖。
 */
function parseInlineBlock(body: string): ClarifyQuestion | null {
  const parts = body.split(/\s+-\s+/).map((s: string) => s.trim()).filter(Boolean);
  if (parts.length < 3) return null;

  const qMatch = parts[0].match(/^Q\d*\s*[:：]\s*(.+)$/);
  if (!qMatch) return null;
  const question = qMatch[1].trim();
  if (!question) return null;

  const labelRe = /^(?:选项\s+)?[A-Za-z\d]+\s*[:：)]\s*(.+)$/;
  const options: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const optMatch = parts[i].match(labelRe);
    options.push(optMatch ? optMatch[1].trim() : parts[i]);
  }

  if (options.length < 2) return null;
  return { question, options };
}

/**
 * 解析 text 内所有 <clarify>...</clarify> 块。
 * - 含换行的 body 走多行解析;
 * - 单行 body 走内联解析;
 * 任一解析器返回有效结果(>=2 选项)即加入列表。
 */
export function parseClarifyBlocks(text: string): ClarifyQuestion[] {
  if (!text || !text.includes("<clarify")) return [];
  const out: ClarifyQuestion[] = [];
  CLARIFY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLARIFY_RE.exec(text)) !== null) {
    const raw = match[1] ?? "";
    const body = raw.trim();
    if (!body) continue;
    if (/[\r\n]/.test(body)) {
      out.push(...parseMultilineBlocks(body));
    } else {
      const r = parseInlineBlock(body);
      if (r) out.push(r);
    }
  }
  return out;
}

/** Format a user reply from selected options (one question → one answer line). */
export function formatClarifyReply(selections: Array<{ question: string; option: string }>): string {
  return selections
    .map((s) => `${s.question}\n→ ${s.option}`)
    .join("\n\n");
}