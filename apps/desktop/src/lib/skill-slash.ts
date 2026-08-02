import type { SessionSkillInfo, SessionSlashItem } from "@shared/ipc";
import {
  applySlashItemInsert,
  detectSlashFragment,
  filterSlashItemsByQuery,
  type SlashMatch,
} from "./slash-menu";

/** @deprecated Prefer {@link SlashMatch}. */
export type SkillSlashMatch = SlashMatch;

/**
 * Detect an active skill slash fragment at the cursor:
 * `/` at start or after whitespace, then optional non-space query.
 */
export function detectSkillSlash(
  value: string,
  cursor: number,
): SkillSlashMatch | null {
  return detectSlashFragment(value, cursor);
}

/** Case-insensitive filter on name + description. */
export function filterSkillsByQuery(
  skills: SessionSkillInfo[],
  query: string,
): SessionSkillInfo[] {
  const asItems: SessionSlashItem[] = skills.map((s) => ({
    name: s.name,
    description: s.description ?? "",
    source: "skill" as const,
  }));
  return filterSlashItemsByQuery(asItems, query).map((s) => ({
    name: s.name,
    description: s.description,
  }));
}

/**
 * Replace the slash fragment with `/skill:<name> ` and place cursor after.
 */
export function applySkillSlashInsert(
  value: string,
  match: SkillSlashMatch,
  skillName: string,
): { value: string; cursor: number } {
  return applySlashItemInsert(value, match, {
    name: skillName,
    description: "",
    source: "skill",
  });
}
