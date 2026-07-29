import type { SessionSkillInfo } from "@shared/ipc";

export type SkillSlashMatch = {
  /** Absolute start index of `/` in the full input. */
  start: number;
  /** Absolute end index (exclusive) of the slash fragment (before cursor). */
  end: number;
  /** Text after `/` (may be empty). */
  query: string;
};

/**
 * Detect an active skill slash fragment at the cursor:
 * `/` at start or after whitespace, then optional non-space query.
 */
export function detectSkillSlash(
  value: string,
  cursor: number,
): SkillSlashMatch | null {
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

/** Case-insensitive filter on name + description. */
export function filterSkillsByQuery(
  skills: SessionSkillInfo[],
  query: string,
): SessionSkillInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => {
    const name = s.name.toLowerCase();
    const desc = (s.description ?? "").toLowerCase();
    return name.includes(q) || desc.includes(q);
  });
}

/**
 * Replace the slash fragment with `/skill:<name> ` and place cursor after.
 */
export function applySkillSlashInsert(
  value: string,
  match: SkillSlashMatch,
  skillName: string,
): { value: string; cursor: number } {
  const token = `/skill:${skillName} `;
  const next = value.slice(0, match.start) + token + value.slice(match.end);
  return { value: next, cursor: match.start + token.length };
}
