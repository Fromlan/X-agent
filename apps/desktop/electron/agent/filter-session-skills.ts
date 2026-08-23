import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { excludeUserAgentsHomeSkills } from "./exclude-agents-home-skills";
import { filterSkillsForStage } from "./filter-stage-skills";
import type { StageId } from "../../shared/stage";

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
 * drop user-disabled skills → drop stage-irrelevant skills →
 * dedupe by name → truncate descriptions for the index.
 */
export function applyXAgentSkillsFilter<
  T extends { name?: string; filePath: string; description?: string },
>(
  skills: T[],
  cwd: string,
  disabledSkills: readonly string[] = [],
  stage: StageId | null = null,
): T[] {
  const filtered = filterDisabledSkills(
    filterGodotSkillsForCwd(excludeUserAgentsHomeSkills(skills), cwd),
    disabledSkills,
  );
  const stageFiltered = filterSkillsForStage(filtered, stage);
  return truncateSkillsForIndex(dedupeSkillsByName(stageFiltered));
}
