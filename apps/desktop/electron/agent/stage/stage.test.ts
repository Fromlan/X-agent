import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StageController } from "./controller";
import { STAGE_DEFINITIONS } from "../../../shared/stage-defs";
import type { ProjectStage } from "../../../shared/stage";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "x-agent-stage-"));
});

afterEach(() => {
  if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
});

describe("StageController", () => {
  it("returns null info before bind", () => {
    const ctrl = new StageController();
    expect(ctrl.getInfo()).toBeNull();
    expect(ctrl.getCurrent()).toBeNull();
  });

  it("bind() to an empty project defaults to design and seeds artifacts", () => {
    const ctrl = new StageController();
    const info = ctrl.bind(cwd);
    expect(info).not.toBeNull();
    expect(info!.current).toBe("design");
    expect(info!.definition.id).toBe("design");
    // Seed artifacts present.
    expect(existsSync(join(cwd, STAGE_DEFINITIONS.design.artifactsDir, "01-gdd.md"))).toBe(true);
  });

  it("bind() to a project that already has a stage file restores it", () => {
    mkdirSync(join(cwd, ".x-agent"), { recursive: true });
    const persisted: ProjectStage = {
      schemaVersion: 1,
      current: "prototype",
      history: [
        { from: "design", to: "prototype", at: "2026-01-01T00:00:00.000Z", reason: "user" },
      ],
      manualChecks: {},
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    writeFileSync(
      join(cwd, ".x-agent", "stage.json"),
      JSON.stringify(persisted, null, 2),
      "utf8",
    );
    const ctrl = new StageController();
    const info = ctrl.bind(cwd);
    expect(info!.current).toBe("prototype");
    expect(info!.history.length).toBe(1);
  });

  it("setStage updates current and appends history", () => {
    const ctrl = new StageController();
    ctrl.bind(cwd);
    const result = ctrl.setStage("prototype");
    expect(result.ok).toBe(true);
    expect(ctrl.getCurrent()).toBe("prototype");
    const info = ctrl.getInfo()!;
    expect(info.history.length).toBe(1);
    expect(info.history[0]!.from).toBe("design");
    expect(info.history[0]!.to).toBe("prototype");
  });

  it("setStage to the same stage is a no-op (no new history)", () => {
    const ctrl = new StageController();
    ctrl.bind(cwd);
    ctrl.setStage("prototype");
    ctrl.setStage("prototype");
    const info = ctrl.getInfo()!;
    expect(info.history.length).toBe(1);
  });

  it("setStage persists the new state atomically", () => {
    const ctrl = new StageController();
    ctrl.bind(cwd);
    ctrl.setStage("test");
    // New StageController should see test as the current stage.
    const ctrl2 = new StageController();
    ctrl2.bind(cwd);
    expect(ctrl2.getCurrent()).toBe("test");
  });

  it("subscribe fires on bind and setStage", () => {
    const ctrl = new StageController();
    const events: string[] = [];
    ctrl.subscribe((info) => events.push(info.current));
    ctrl.bind(cwd);
    ctrl.setStage("prototype");
    ctrl.setStage("test");
    expect(events).toEqual(["design", "prototype", "test"]);
  });

  it("setStage fails when no project is bound", () => {
    const ctrl = new StageController();
    const result = ctrl.setStage("prototype");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/未打开项目/);
  });

  it("toggleManualCheck updates and returns graduation", () => {
    const ctrl = new StageController();
    ctrl.bind(cwd);
    // design stage has 3 checks: 2 file-* + 1 manual
    const grad1 = ctrl.getGraduation("design")!;
    expect(grad1.total).toBe(3);
    const manualId = "design-core-loop";
    const idx = grad1.checks.findIndex((c) => c.id === manualId);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(grad1.checks[idx]!.passed).toBe(false);

    const grad2 = ctrl.toggleManualCheck(manualId, true)!;
    const idx2 = grad2.checks.findIndex((c) => c.id === manualId);
    expect(grad2.checks[idx2]!.passed).toBe(true);
  });

  it("expand stage has zero graduation checks", () => {
    const ctrl = new StageController();
    ctrl.bind(cwd);
    ctrl.setStage("expand");
    const grad = ctrl.getGraduation("expand")!;
    expect(grad.total).toBe(0);
    expect(grad.allPassed).toBe(false);
    expect(grad.canSkip).toBe(true);
  });

  it("file-count graduation check passes when enough files exist", () => {
    const ctrl = new StageController();
    ctrl.bind(cwd);
    // .x-agent/design/01-gdd.md was seeded.
    const grad = ctrl.getGraduation("design")!;
    const gddCheck = grad.checks.find((c) => c.id === "design-gdd")!;
    expect(gddCheck.passed).toBe(true);
  });

  it("file-count graduation check fails when files are missing", () => {
    const ctrl = new StageController();
    ctrl.bind(cwd);
    // Remove the seeded design file.
    rmSync(join(cwd, STAGE_DEFINITIONS.design.artifactsDir), { recursive: true, force: true });
    const grad = ctrl.getGraduation("design")!;
    const gddCheck = grad.checks.find((c) => c.id === "design-gdd")!;
    expect(gddCheck.passed).toBe(false);
  });

  it("invalid stage.json is backed up and reset to design", () => {
    mkdirSync(join(cwd, ".x-agent"), { recursive: true });
    // Valid JSON but wrong schema → triggers backup branch.
    writeFileSync(
      join(cwd, ".x-agent", "stage.json"),
      JSON.stringify({ schemaVersion: 99, current: "design" }),
      "utf8",
    );
    const ctrl = new StageController();
    const info = ctrl.bind(cwd);
    expect(info!.current).toBe("design");
    // Backup should exist
    const files = readdirSync(join(cwd, ".x-agent"));
    expect(files.some((f) => f.startsWith("stage.json.bak-"))).toBe(true);
  });
});
