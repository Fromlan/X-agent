/**
 * Vitest — shared game-stage constants and prompt builders.
 */
import { describe, expect, it } from "vitest";
import {
  GAME_STAGES,
  GAME_STAGE_LABELS,
  WRITE_GAME_DOC_TOOL,
  buildGameStageSystemAppend,
  isGameStage,
} from "./game-stage";

describe("game-stage", () => {
  it("exposes four canonical stages", () => {
    expect(GAME_STAGES).toEqual([
      "planning",
      "prototype",
      "testing",
      "expansion",
    ]);
  });

  it("accepts valid stages and rejects unknown strings", () => {
    expect(isGameStage("planning")).toBe(true);
    expect(isGameStage("production")).toBe(false);
  });

  it("labels all stages in Chinese", () => {
    expect(GAME_STAGE_LABELS.planning).toBe("策划");
    expect(GAME_STAGE_LABELS.prototype).toBe("原型");
    expect(GAME_STAGE_LABELS.testing).toBe("测试");
    expect(GAME_STAGE_LABELS.expansion).toBe("扩充");
  });

  it("planning prompt includes write_game_doc and planning guidance", () => {
    const out = buildGameStageSystemAppend("planning");
    expect(out).toContain("STAGE: planning");
    expect(out).toContain("write_game_doc");
    expect(out).toContain("Do NOT modify game code");
  });

  it("testing prompt includes debug guidance", () => {
    const out = buildGameStageSystemAppend("testing");
    expect(out).toContain("Help the user play the prototype");
    expect(out).toContain(".game/test/bugs.md");
  });

  it("write_game_doc is a distinct custom tool", () => {
    expect(WRITE_GAME_DOC_TOOL).toBe("write_game_doc");
  });
});
