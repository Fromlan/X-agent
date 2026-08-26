import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { excludeUserAgentsHomeSkills } from "./exclude-agents-home-skills";
import type { SessionType } from "../../shared/session-type";

/** Max skill description length injected into `<available_skills>` (chars). */
export const SKILL_INDEX_DESCRIPTION_MAX = 240;

/** True when cwd looks like a Godot project root. */
export function isGodotProjectRoot(cwd: string): boolean {
  if (!cwd) return false;
  return existsSync(join(cwd, "project.godot"));
}

/**
 * Resolve skill id for filtering: prefer explicit `name`, else parent dir of SKILL.md.
 */
export function skillIdForFilter(skill: {
  name?: string;
  filePath?: string;
}): string {
  const named = skill.name?.trim();
  if (named) return named;
  const filePath = skill.filePath?.trim();
  if (!filePath) return "";
  const base = basename(filePath);
  if (base.toLowerCase() === "skill.md") {
    return basename(dirname(filePath));
  }
  return base;
}

/** Drop godot-* skills when the session cwd is not a Godot project. */
export function filterGodotSkillsForCwd<
  T extends { name?: string; filePath?: string },
>(skills: T[], cwd: string): T[] {
  if (isGodotProjectRoot(cwd)) return skills;
  return skills.filter((s) => !skillIdForFilter(s).startsWith("godot-"));
}

/** Keep first occurrence per skill id (name / parent dir). */
export function dedupeSkillsByName<
  T extends { name?: string; filePath?: string },
>(skills: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const skill of skills) {
    const id = skillIdForFilter(skill).toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(skill);
  }
  return out;
}

/**
 * Truncate skill description for the system-prompt index only.
 * Full SKILL.md on disk is unchanged; model can `read` for details.
 */
export function truncateSkillDescription(
  description: string | undefined,
  maxLen: number = SKILL_INDEX_DESCRIPTION_MAX,
): string {
  const text = (description ?? "").trim();
  if (text.length <= maxLen) return text;
  if (maxLen <= 3) return text.slice(0, maxLen);
  return `${text.slice(0, maxLen - 3).trimEnd()}...`;
}

export function truncateSkillsForIndex<
  T extends { name?: string; filePath: string; description?: string },
>(skills: T[], maxLen: number = SKILL_INDEX_DESCRIPTION_MAX): T[] {
  return skills.map((skill) => ({
    ...skill,
    description: truncateSkillDescription(skill.description, maxLen),
  }));
}

/** Drop skills whose id is in the user disabled list (case-insensitive). */
export function filterDisabledSkills<
  T extends { name?: string; filePath?: string },
>(skills: T[], disabledSkills: readonly string[] = []): T[] {
  if (disabledSkills.length === 0) return skills;
  const disabled = new Set(
    disabledSkills.map((id) => id.trim().toLowerCase()).filter(Boolean),
  );
  if (disabled.size === 0) return skills;
  return skills.filter((s) => {
    const id = skillIdForFilter(s).toLowerCase();
    return !id || !disabled.has(id);
  });
}

/**
 * X-agent DefaultResourceLoader skillsOverride pipeline:
 * exclude ~/.agents/skills → hide godot-* outside Godot projects →
 * drop user-disabled skills → dedupe by name → truncate descriptions for the index.
 *
 * If `sessionType === "design"`, design-shaped skills (`design-*` / `*-design` /
 * `gamedesign-*`) are surfaced first in the index so the agent sees them at the
 * top of its skill list. No skills are pre-installed (策划专用 skills 独立 PR).
 *
 * Type decisions are now centralized in `SessionTypePolicy`. Prefer the
 * policy-based variant `applyXAgentSkillsFilterForPolicy` in new code; this
 * function remains for backward compatibility with the script tests.
 */
export function applyXAgentSkillsFilter<
  T extends { name?: string; filePath: string; description?: string },
>(
  skills: T[],
  cwd: string,
  disabledSkills: readonly string[] = [],
  sessionType: SessionType = "code",
): T[] {
  const base = excludeUserAgentsHomeSkills(skills);
  const cwdFiltered = filterGodotSkillsForCwd(base, cwd);
  const reordered = sessionType === "design" ? prioritizeDesignSkills(cwdFiltered) : cwdFiltered;
  const filtered = filterDisabledSkills(reordered, disabledSkills);
  return truncateSkillsForIndex(dedupeSkillsByName(filtered));
}

/**
 * Stable reorder: surface any skill whose name starts with `design-`,
 * `gamedesign-`, or ends with `-design` to the top. Original order within
 * each group is preserved. Non-matching skills follow.
 *
 * MVP placeholder —策划 skills 真正落地后这个函数会扩.
 */
function prioritizeDesignSkills<
  T extends { name?: string; filePath: string },
>(skills: T[]): T[] {
  const isDesign = (s: T): boolean => {
    const id = skillIdForFilter(s).toLowerCase();
    if (!id) return false;
    return id.startsWith("design-") || id.startsWith("gamedesign-") || id.endsWith("-design");
  };
  const head: T[] = [];
  const tail: T[] = [];
  for (const s of skills) {
    if (isDesign(s)) head.push(s);
    else tail.push(s);
  }
  return [...head, ...tail];
}
