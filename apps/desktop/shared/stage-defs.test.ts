import { describe, expect, it } from "vitest";
import {
  STAGE_IDS,
  isStageId,
  nextStage,
  previousStage,
  stageDescription,
  stageLabel,
} from "./stage";
import { STAGE_DEFINITIONS } from "./stage-defs";
import { buildStageSystemAppend } from "./stage-prompt";

describe("stage static defs", () => {
  it("every StageId has a StageDefinition", () => {
    for (const id of STAGE_IDS) {
      expect(STAGE_DEFINITIONS[id]).toBeDefined();
      expect(STAGE_DEFINITIONS[id].id).toBe(id);
    }
  });

  it("each stage has a non-empty system append and labels", () => {
    for (const id of STAGE_IDS) {
      const def = STAGE_DEFINITIONS[id];
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.shortLabel.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      // system append should contain the stage id (or at least be non-empty).
      expect(def.systemAppend.length).toBeGreaterThan(20);
    }
  });

  it("buildStageSystemAppend matches the cached append in defs", () => {
    for (const id of STAGE_IDS) {
      const def = STAGE_DEFINITIONS[id];
      const built = buildStageSystemAppend(id);
      expect(built).toBe(def.systemAppend);
    }
  });

  it("each stage has a non-empty rightPanelTabs list with a preferred tab", () => {
    for (const id of STAGE_IDS) {
      const def = STAGE_DEFINITIONS[id];
      expect(def.rightPanelTabs.length).toBeGreaterThan(0);
      expect(def.rightPanelTabs).toContain(def.preferredRightPanelTab);
    }
  });

  it("design has a strict readonly toolset", () => {
    const def = STAGE_DEFINITIONS.design;
    expect(def.toolPreset).toBe("readonly-design");
    expect(def.defaultMode).toBe("plan");
  });

  it("expand uses the full toolset and full skills", () => {
    const def = STAGE_DEFINITIONS.expand;
    expect(def.toolPreset).toBe("full");
    expect(def.skillPreset).toBe("full");
    expect(def.defaultMode).toBe("agent");
    expect(def.graduation.length).toBe(0);
  });

  it("isStageId rejects unknown values", () => {
    expect(isStageId("design")).toBe(true);
    expect(isStageId("prototype")).toBe(true);
    expect(isStageId("test")).toBe(true);
    expect(isStageId("expand")).toBe(true);
    expect(isStageId("planning")).toBe(false);
    expect(isStageId("unknown")).toBe(false);
    expect(isStageId(null)).toBe(false);
    expect(isStageId(42)).toBe(false);
  });

  it("nextStage / previousStage transitions", () => {
    expect(nextStage("design")).toBe("prototype");
    expect(nextStage("prototype")).toBe("test");
    expect(nextStage("test")).toBe("expand");
    expect(nextStage("expand")).toBeNull();
    expect(nextStage(null)).toBe("design");
    expect(previousStage("design")).toBeNull();
    expect(previousStage("prototype")).toBe("design");
    expect(previousStage("expand")).toBe("test");
  });

  it("stageLabel / stageDescription fall back gracefully", () => {
    expect(stageLabel("design")).toBe("策划");
    expect(stageLabel(null)).toBe("未选择阶段");
    expect(stageDescription("prototype").length).toBeGreaterThan(0);
    expect(stageDescription(null)).toBe("尚未进入游戏开发流程");
  });
});
