/**
 * Plan markdown checkbox todos: parse and toggle `- [ ]` / `- [x]` lines.
 */

export type PlanTodoItem = {
  /** 0-based line index in the markdown. */
  lineIndex: number;
  checked: boolean;
  text: string;
};

const TODO_RE = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;

export function parsePlanTodos(markdown: string): PlanTodoItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: PlanTodoItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TODO_RE);
    if (!m) continue;
    items.push({
      lineIndex: i,
      checked: m[2].toLowerCase() === "x",
      text: m[3].trim(),
    });
  }
  return items;
}

/** Toggle the checkbox at lineIndex; returns new markdown (or original if no match). */
export function togglePlanTodo(
  markdown: string,
  lineIndex: number,
  checked?: boolean,
): string {
  const lines = markdown.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) return markdown;
  const m = lines[lineIndex].match(TODO_RE);
  if (!m) return markdown;
  const currentlyChecked = m[2].toLowerCase() === "x";
  const nextChecked = checked ?? !currentlyChecked;
  const mark = nextChecked ? "x" : " ";
  lines[lineIndex] = `${m[1]}- [${mark}] ${m[3]}`;
  return lines.join("\n");
}
