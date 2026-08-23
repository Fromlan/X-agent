/**
 * Vitest — stage-aware tool allowlists.
 */
import { describe, expect, it } from "vitest";
import { GODOT_TOOLS } from "../../../shared/ipc";
import { WRITE_GAME_DOC_TOOL } from "../../../shared/game-stage";
import {
  PROTOTYPE_GODOT_TOOLS,
  computeModeToolsWithStage,
  computePlanningStageTools,
  isStageAutoGodotTool,
} from "./stage-tools";

const PREFS = ["read", "edit", "write", "bash"];

describe("stage-tools", () => {
  it("planning toolset is read-only plus plan/doc writers", () => {
    const tools = computePlanningStageTools(PREFS);
    expect(tools).toContain("write_plan");
    expect(tools).toContain(WRITE_GAME_DOC_TOOL);
    expect(tools).not.toContain("edit");
    expect(tools).not.toContain("write");
  });

  it("testing auto-enables all Godot tools while preserving prefs", () => {
    const tools = computeModeToolsWithStage("testing", "agent", PREFS);
    for (const g of GODOT_TOOLS) expect(tools).toContain(g);
    expect(tools).toContain("edit");
  });

  it("prototype auto-enables only the prototype Godot subset", () => {
    const tools = computeModeToolsWithStage("prototype", "agent", PREFS);
    for (const g of PROTOTYPE_GODOT_TOOLS) expect(tools).toContain(g);
    expect(tools).not.toContain("godot_set_project_setting");
  });

  it("ask mode stays read-only even in testing stage", () => {
    const tools = computeModeToolsWithStage("testing", "ask", PREFS);
    expect(tools).not.toContain("edit");
    expect(tools).not.toContain("write");
  });

  it("isStageAutoGodotTool grants full Godot tools for testing/expansion", () => {
    expect(isStageAutoGodotTool("testing", "godot_run_scene")).toBe(true);
    expect(isStageAutoGodotTool("expansion", "godot_run_scene")).toBe(true);
    expect(isStageAutoGodotTool("planning", "godot_run_scene")).toBe(false);
  });
});
