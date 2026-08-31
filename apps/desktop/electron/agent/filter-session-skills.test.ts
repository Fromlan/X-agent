/**
 * Vitest 套件 — 覆盖 `applyXAgentSkillsFilter` 在 design session 下的
 * "内置 5 个 design skill 顶置" 集成契约.
 *
 * 之前由 `scripts/test-design-builtin-skills.ts` 离线脚本承担; 0.4.0 起
 * 关键模块统一迁 vitest,本文件承接 (2026-08-31 加深评审 C-101 收口时
 * 顺带收敛 — 离线脚本因 ?raw 导入 SKILL.md 失效).
 */
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyXAgentSkillsFilter } from "./filter-session-skills";
import { BUILTIN_DESIGN_SKILL_IDS } from "./design-builtin-skills";
import { ensureBuiltinDesignSkillsInstalled, getBuiltinSkillFilePath } from "./design-builtin-skills";

describe("applyXAgentSkillsFilter + 设计内置 5 skill 集成", () => {
  let tmpAgentDir: string;

  beforeEach(() => {
    tmpAgentDir = mkdtempSync(join(tmpdir(), "x-agent-filter-design-"));
    ensureBuiltinDesignSkillsInstalled({ agentDirPath: tmpAgentDir });
  });

  afterEach(() => {
    rmSync(tmpAgentDir, { recursive: true, force: true });
  });

  it("design session: 5 个 BUILTIN 顶置 (按 BUILTIN_DESIGN_SKILL_IDS 顺序)", () => {
    const fakeSkillList = [
      ...BUILTIN_DESIGN_SKILL_IDS.map((id) => ({
        name: id,
        description: "",
        filePath: getBuiltinSkillFilePath(id, tmpAgentDir),
      })),
      { name: "some-other-skill", description: "", filePath: "/tmp/other/SKILL.md" },
      { name: "godot-docs-4-7", description: "", filePath: "/tmp/godot/SKILL.md" },
    ];
    const filtered = applyXAgentSkillsFilter(fakeSkillList, tmpAgentDir, [], "design");
    const top5 = filtered.slice(0, 5).map((s) => s.name);
    expect(top5).toEqual([...BUILTIN_DESIGN_SKILL_IDS]);
  });

  it("code session: 5 个 BUILTIN 保留但不顶置", () => {
    const fakeSkillList = [
      ...BUILTIN_DESIGN_SKILL_IDS.map((id) => ({
        name: id,
        description: "",
        filePath: getBuiltinSkillFilePath(id, tmpAgentDir),
      })),
      { name: "some-other-skill", description: "", filePath: "/tmp/other/SKILL.md" },
    ];
    const filtered = applyXAgentSkillsFilter(fakeSkillList, tmpAgentDir, [], "code");
    const hasAll5 = BUILTIN_DESIGN_SKILL_IDS.every((id) =>
      filtered.some((s) => s.name === id),
    );
    expect(hasAll5).toBe(true);
  });
});
