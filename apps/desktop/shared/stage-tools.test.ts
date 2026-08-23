import { describe, expect, it } from "vitest";
import {
  computeStageTools,
  isDesignStage,
  isStageAutoGodotTool,
  presetForStage,
  PROTOTYPE_GODOT_TOOLS,
  TEST_GODOT_TOOLS,
} from "./stage-tools";
import { GODOT_TOOLS } from "./ipc";
import type { AgentSessionMode } from "./ipc";
import type { StageId } from "./stage";

const ALL_PREFS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "godot_detect_project",
];

describe("stage-tools", () => {
  describe("isDesignStage", () => {
    it("only design returns true", () => {
      expect(isDesignStage("design")).toBe(true);
      expect(isDesignStage("prototype")).toBe(false);
      expect(isDesignStage("test")).toBe(false);
      expect(isDesignStage("expand")).toBe(false);
      expect(isDesignStage(null)).toBe(false);
      expect(isDesignStage(undefined)).toBe(false);
    });
  });

  describe("presetForStage", () => {
    it("returns the right preset per stage", () => {
      expect(presetForStage("design")).toBe("readonly-design");
      expect(presetForStage("prototype")).toBe("prototype-write");
      expect(presetForStage("test")).toBe("test-debug");
      expect(presetForStage("expand")).toBe("full");
      expect(presetForStage(null)).toBe("full");
    });
  });

  describe("isStageAutoGodotTool", () => {
    it("expand and test expose the full Godot set", () => {
      for (const tool of GODOT_TOOLS) {
        expect(isStageAutoGodotTool("expand", tool)).toBe(true);
        expect(isStageAutoGodotTool("test", tool)).toBe(true);
      }
    });
    it("prototype exposes the prototype set", () => {
      for (const tool of PROTOTYPE_GODOT_TOOLS) {
        expect(isStageAutoGodotTool("prototype", tool)).toBe(true);
      }
      expect(isStageAutoGodotTool("prototype", "godot_export_project")).toBe(false);
    });
    it("design exposes no Godot tools beyond the optional read-only ones", () => {
      expect(isStageAutoGodotTool("design", "godot_run_main_scene")).toBe(false);
      expect(isStageAutoGodotTool("design", "godot_set_project_setting")).toBe(false);
    });
    it("null stage exposes nothing", () => {
      expect(isStageAutoGodotTool(null, "godot_editor_info")).toBe(false);
    });
  });

  describe("computeStageTools", () => {
    const stages: StageId[] = ["design", "prototype", "test", "expand"];
    const modes: AgentSessionMode[] = ["agent", "ask", "plan", "goal"];

    it("ask mode is always readonly regardless of stage", () => {
      for (const stage of stages) {
        const tools = computeStageTools(stage, "ask", ALL_PREFS);
        // ask mode returns the ask toolset (read + grep + find + ls + bash + extension)
        expect(tools).toContain("read");
        expect(tools).not.toContain("write");
        expect(tools).not.toContain("edit");
        expect(tools).not.toContain("write_plan");
      }
    });

    it("plan mode is readonly + write_plan regardless of stage", () => {
      for (const stage of stages) {
        const tools = computeStageTools(stage, "plan", ALL_PREFS);
        expect(tools).toContain("read");
        expect(tools).toContain("write_plan");
        expect(tools).not.toContain("edit");
        expect(tools).not.toContain("write");
      }
    });

    it("design stage forces plan-mode toolset even in agent mode", () => {
      const tools = computeStageTools("design", "agent", ALL_PREFS);
      expect(tools).toContain("write_plan");
      expect(tools).not.toContain("write");
      expect(tools).not.toContain("edit");
    });

    it("agent + prototype exposes prototype Godot tools", () => {
      const tools = computeStageTools("prototype", "agent", ALL_PREFS);
      expect(tools).toContain("read");
      expect(tools).toContain("write");
      expect(tools).toContain("edit");
      for (const t of PROTOTYPE_GODOT_TOOLS) {
        expect(tools).toContain(t);
      }
    });

    it("agent + test exposes the test Godot toolset", () => {
      const tools = computeStageTools("test", "agent", ALL_PREFS);
      expect(tools).toContain("read");
      // edit allowed (debugging)
      expect(tools).toContain("edit");
      for (const t of TEST_GODOT_TOOLS) {
        expect(tools).toContain(t);
      }
    });

    it("agent + expand exposes the full Godot set on top of prefs", () => {
      const tools = computeStageTools("expand", "agent", ALL_PREFS);
      for (const t of GODOT_TOOLS) {
        expect(tools).toContain(t);
      }
    });

    it("goal mode follows agent semantics", () => {
      const designTools = computeStageTools("design", "goal", ALL_PREFS);
      expect(designTools).toContain("write_plan");
      expect(designTools).not.toContain("write");
      const expandTools = computeStageTools("expand", "goal", ALL_PREFS);
      for (const t of GODOT_TOOLS) {
        expect(expandTools).toContain(t);
      }
    });

    it("null stage in agent mode just returns prefs", () => {
      const tools = computeStageTools(null, "agent", ALL_PREFS);
      // All prefs present, no Godot auto-add.
      for (const t of ALL_PREFS) {
        expect(tools).toContain(t);
      }
      expect(tools).not.toContain("godot_run_main_scene");
    });

    it("doesn't mutate the prefs array", () => {
      const before = [...ALL_PREFS];
      computeStageTools("expand", "agent", ALL_PREFS);
      expect(ALL_PREFS).toEqual(before);
    });
  });
});
