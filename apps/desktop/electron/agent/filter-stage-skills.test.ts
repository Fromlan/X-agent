import { describe, expect, it } from "vitest";
import { filterSkillsForStage } from "./filter-stage-skills";

const make = (name: string, filePath: string) => ({
  name,
  filePath,
  description: "",
});

describe("filterSkillsForStage", () => {
  const SKILLS = [
    make("godot-docs-4-7", "C:/skills/godot-docs-4-7/SKILL.md"),
    make("godot-feature-workflow", "C:/skills/godot-feature-workflow/SKILL.md"),
    make("godot-tscn-format", "C:/skills/godot-tscn-format/SKILL.md"),
    make("gdscript-codegen", "C:/skills/gdscript-codegen/SKILL.md"),
    make("godot-asset-path-surgery", "C:/skills/godot-asset-path-surgery/SKILL.md"),
    make("godot-headless-verify", "C:/skills/godot-headless-verify/SKILL.md"),
    make("x-tdd", "C:/skills/x-tdd/SKILL.md"),
    make("x-diagnose", "C:/skills/x-diagnose/SKILL.md"),
    make("x-review", "C:/skills/x-review/SKILL.md"),
    make("x-safe-edit", "C:/skills/x-safe-edit/SKILL.md"),
    make("x-glossary", "C:/skills/x-glossary/SKILL.md"),
    make("game-design-master", "C:/skills/game-design-master/SKILL.md"),
  ];

  it("design excludes code-level skills", () => {
    const result = filterSkillsForStage(SKILLS, "design").map((s) => s.name);
    expect(result).toContain("godot-docs-4-7");
    expect(result).toContain("x-glossary");
    expect(result).toContain("game-design-master");
    // Excluded
    expect(result).not.toContain("gdscript-codegen");
    expect(result).not.toContain("godot-tscn-format");
    expect(result).not.toContain("x-tdd");
  });

  it("prototype keeps feature / codegen / format skills but excludes asset-path", () => {
    const result = filterSkillsForStage(SKILLS, "prototype").map((s) => s.name);
    expect(result).toContain("godot-feature-workflow");
    expect(result).toContain("gdscript-codegen");
    expect(result).toContain("godot-tscn-format");
    expect(result).toContain("x-tdd");
    expect(result).not.toContain("godot-asset-path-surgery");
  });

  it("test keeps tdd / diagnose / headless-verify", () => {
    const result = filterSkillsForStage(SKILLS, "test").map((s) => s.name);
    expect(result).toContain("x-tdd");
    expect(result).toContain("x-diagnose");
    expect(result).toContain("godot-headless-verify");
    expect(result).toContain("godot-asset-path-surgery");
  });

  it("expand is permissive", () => {
    const result = filterSkillsForStage(SKILLS, "expand").map((s) => s.name);
    expect(result.length).toBe(SKILLS.length);
  });

  it("null stage returns input unchanged", () => {
    const result = filterSkillsForStage(SKILLS, null);
    expect(result.length).toBe(SKILLS.length);
  });

  it("derives id from file path when name is missing", () => {
    const anon = [
      { name: undefined as unknown as string, filePath: "C:/skills/x-grill/SKILL.md" },
    ];
    const result = filterSkillsForStage(anon, "design");
    expect(result.length).toBe(1);
  });
});
