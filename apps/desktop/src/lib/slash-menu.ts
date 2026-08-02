import type { SessionSlashItem } from "@shared/ipc";

export type SlashMatch = {
  /** Absolute start index of `/` in the full input. */
  start: number;
  /** Absolute end index (exclusive) of the slash fragment (before cursor). */
  end: number;
  /** Text after `/` (may be empty). */
  query: string;
};

/**
 * Detect an active slash fragment at the cursor:
 * `/` at start or after whitespace, then optional non-space query.
 */
export function detectSlashFragment(
  value: string,
  cursor: number,
): SlashMatch | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, safeCursor);
  const m = before.match(/(?:^|[\s])\/([^\s]*)$/);
  if (!m) return null;
  const query = m[1] ?? "";
  const slashIndex = before.length - query.length - 1;
  if (value[slashIndex] !== "/") return null;
  return {
    start: slashIndex,
    end: safeCursor,
    query,
  };
}

/** Case-insensitive filter on name / description / argumentHint / skill: prefix. */
export function filterSlashItemsByQuery(
  items: SessionSlashItem[],
  query: string,
): SessionSlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const qWithoutSkillPrefix = q.startsWith("skill:") ? q.slice("skill:".length) : q;
  return items.filter((item) => {
    const name = item.name.toLowerCase();
    const desc = (item.description ?? "").toLowerCase();
    const hint = (item.argumentHint ?? "").toLowerCase();
    const skillToken =
      item.source === "skill" ? `skill:${name}` : "";
    return (
      name.includes(q) ||
      name.includes(qWithoutSkillPrefix) ||
      desc.includes(q) ||
      hint.includes(q) ||
      (skillToken.length > 0 && skillToken.includes(q))
    );
  });
}

/** Insert token for a slash item (`/skill:name ` or `/name `). */
export function applySlashItemInsert(
  value: string,
  match: SlashMatch,
  item: SessionSlashItem,
): { value: string; cursor: number } {
  const token =
    item.source === "skill" ? `/skill:${item.name} ` : `/${item.name} `;
  const next = value.slice(0, match.start) + token + value.slice(match.end);
  return { value: next, cursor: match.start + token.length };
}

export function slashSourceLabel(
  source: SessionSlashItem["source"],
): string {
  switch (source) {
    case "command":
      return "命令";
    case "prompt":
      return "提示词";
    case "skill":
      return "技能";
  }
}
