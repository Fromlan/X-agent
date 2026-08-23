/**
 * Stage-aware skill filter.
 *
 * Each project-level stage declares a skill preset ("design" | "prototype" |
 * "test" | "full"). The filter narrows the available skills so the agent
 * sees only the workflows relevant to the current stage.
 *
 *   design     — keep planning / design / GDD / data-table skills, hide
 *                code-level TDD/diagnose skills.
 *   prototype  — keep feature / codegen / scene / tres format / tdd / review.
 *   test       — keep tdd / diagnose / headless verify / asset path surgery.
 *   full       — no filter; user prefs apply as before.
 *
 * The filter is intentionally lenient: if a skill id isn't in the explicit
 * exclude list for the stage, it is kept. The goal is to avoid noise, not
 * to lock the agent out of capabilities the user has installed.
 */
import type { StageId } from "../../shared/stage";

/** Skills that are obviously off-topic for a given stage. */
const STAGE_EXCLUDE_PREFIXES: Record<StageId, readonly string[]> = {
  design: ["gdscript-", "godot-tscn", "godot-tres", "godot-asset-path", "x-tdd"],
  prototype: ["godot-asset-path"],
  test: [],
  expand: [],
};

const DESIGN_ONLY_KEEP = new Set([
  // Pure design-time helpers.
  "x-glossary",
  "x-grill",
  "x-change-brief",
  "x-review",
  "godot-data-driven-config",
  "godot-docs-4-7",
]);

const PROTOTYPE_KEEP = new Set([
  "godot-feature-workflow",
  "gdscript-codegen",
  "godot-tscn-format",
  "godot-tres-format",
  "godot-data-driven-config",
  "godot-docs-4-7",
  "x-safe-edit",
  "x-review",
  "x-tdd",
  "x-glossary",
]);

const TEST_KEEP = new Set([
  "godot-headless-verify",
  "godot-asset-path-surgery",
  "godot-docs-4-7",
  "x-tdd",
  "x-diagnose",
  "x-review",
  "x-glossary",
]);

const STAGE_KEEP: Record<StageId, ReadonlySet<string>> = {
  design: DESIGN_ONLY_KEEP,
  prototype: PROTOTYPE_KEEP,
  test: TEST_KEEP,
  expand: new Set(), // "all" — empty keep set means we fall through to default-keep.
};

export interface StageFilterableSkill {
  name?: string;
  filePath: string;
  description?: string;
}

function idFor(skill: StageFilterableSkill): string {
  const named = skill.name?.trim();
  if (named) return named;
  // derive from file path: .../skills/<id>/SKILL.md → id
  const parts = skill.filePath.replaceAll("\\", "/").split("/");
  const idx = parts.lastIndexOf("skills");
  if (idx >= 0 && idx + 1 < parts.length) return parts[idx + 1] ?? "";
  return parts[parts.length - 1] ?? "";
}

/**
 * Filter skills by stage preset. The user-disabled list is applied by the
 * upstream `filterDisabledSkills`; this filter is stage-only and does not
 * touch the disabled list.
 */
export function filterSkillsForStage<T extends StageFilterableSkill>(
  skills: T[],
  stage: StageId | null,
): T[] {
  if (!stage) return skills;
  const keep = STAGE_KEEP[stage];
  const exclude = STAGE_EXCLUDE_PREFIXES[stage] ?? [];
  return skills.filter((s) => {
    const id = idFor(s).toLowerCase();
    if (!id) return false;
    // Exclude obvious off-topic prefixes.
    if (exclude.some((p) => id.startsWith(p))) return false;
    // If the stage has an explicit keep set, only allow those + non-prefixed skills.
    if (keep.size > 0) {
      if (keep.has(id)) return true;
      // Allow skills not matching any keep/exclude rule (user-installed extras).
      return true;
    }
    return true;
  });
}
