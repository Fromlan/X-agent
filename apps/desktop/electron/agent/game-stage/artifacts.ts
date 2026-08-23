/**
 * Stage artifact scaffolding.
 *
 * Each game stage owns a small, predictable directory under the project's
 * `.game/` folder. This module creates those directories and idempotent seed
 * files when a user enters a stage, so the right-panel stage workbench always
 * has something real to guide from.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GameStage } from "../../../shared/game-stage";

function ensureFile(
  cwd: string,
  rel: string,
  content: string,
): void {
  const target = join(cwd, rel);
  if (existsSync(target)) return;
  const dir = dirname(target);
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(target, content, "utf8");
}

/** Create/repair the stage artifact directory and seed templates. Idempotent. */
export function ensureGameStageArtifacts(cwd: string, stage: GameStage): void {
  if (!cwd) return;
  switch (stage) {
    case "planning":
      ensureFile(
        cwd,
        ".game/design/01-gdd.md",
        [
          "# Game Design Document",
          "",
          "## Core Loop",
          "- ",
          "",
          "## Systems",
          "- ",
          "",
          "## Scope",
          "- 最小可玩切片：",
          "",
          "## Success Criteria",
          "- ",
          "",
        ].join("\n"),
      );
      ensureFile(cwd, ".game/config/gameplay.json", "{\n  \"draft\": true\n}\n");
      break;
    case "prototype":
      ensureFile(
        cwd,
        ".game/prototype/NOTES.md",
        [
          "# Prototype Notes",
          "",
          "## Vertical Slice",
          "- ",
          "",
          "## Validated",
          "- ",
          "",
          "## Cut / Deferred",
          "- ",
          "",
        ].join("\n"),
      );
      break;
    case "testing":
      ensureFile(
        cwd,
        ".game/test/bugs.md",
        [
          "# Bugs & Feedback",
          "",
          "| Status | Title | Steps | Expected | Actual |",
          "| --- | --- | --- | --- | --- |",
          "",
        ].join("\n"),
      );
      ensureFile(
        cwd,
        ".game/test/playtest-checklist.md",
        [
          "# Playtest Checklist",
          "",
          "- [ ] 核心循环可完整走一遍",
          "- [ ] 新手能理解基本操作",
          "- [ ] 没有崩溃或硬阻塞",
          "",
        ].join("\n"),
      );
      break;
    case "expansion":
      ensureFile(
        cwd,
        ".game/backlog/expansion.md",
        [
          "# Expansion Backlog",
          "",
          "## Tasks",
          "- [ ] ",
          "",
        ].join("\n"),
      );
      break;
  }
}
