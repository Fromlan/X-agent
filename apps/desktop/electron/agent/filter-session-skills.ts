import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { excludeUserAgentsHomeSkills } from "./exclude-agents-home-skills";

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

/**
 * X-agent DefaultResourceLoader skillsOverride pipeline:
 * exclude ~/.agents/skills, then hide godot-* outside Godot projects.
 */
export function applyXAgentSkillsFilter<
  T extends { name?: string; filePath: string },
>(skills: T[], cwd: string): T[] {
  return filterGodotSkillsForCwd(excludeUserAgentsHomeSkills(skills), cwd);
}
