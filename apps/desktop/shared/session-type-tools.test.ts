/**
 * Vitest 单元测试 — session-type 工具集.
 */
import { describe, expect, it } from "vitest";
import {
  DESIGN_SESSION_TYPE_TOOLS,
  computeCodeSessionTypeTools,
  computeDesignSessionTypeTools,
  computeSessionTypeTools,
} from "./session-type-tools";
import {
  PLAN_MODE_OPTIONAL_READONLY_TOOLS,
  READONLY_CORE_TOOLS,
  WRITE_PLAN_TOOL,
} from "./mode-tools";

describe("computeCodeSessionTypeTools", () => {
  it("返回 prefs.tools 副本 (顺序保留)", () => {
    const prefs = ["write", "edit", "bash"];
    expect(computeCodeSessionTypeTools(prefs)).toEqual(prefs);
  });

  it("空 prefs: 返回空数组", () => {
    expect(computeCodeSessionTypeTools([])).toEqual([]);
  });
});

describe("computeDesignSessionTypeTools", () => {
  it("base 包含 readonly core + write/edit, 不含 write_plan", () => {
    const tools = computeDesignSessionTypeTools([]);
    expect(tools).toContain("read");
    expect(tools).toContain("grep");
    expect(tools).toContain("find");
    expect(tools).toContain("ls");
    expect(tools).toContain("bash");
    expect(tools).toContain("write");
    expect(tools).toContain("edit");
    expect(tools).not.toContain(WRITE_PLAN_TOOL);
  });

  it("prefs 启用的额外 readonly Godot 工具被保留", () => {
    // 假设用户在 prefs 启用了 godot_get_scene_tree
    const tools = computeDesignSessionTypeTools([
      "godot_get_scene_tree",
      "godot_lint_scripts",
    ]);
    expect(tools).toContain("godot_get_scene_tree");
    expect(tools).toContain("godot_lint_scripts");
  });

  it("prefs 含非 readonly 工具 (write) 时不传播 (设计 base 已含)", () => {
    // write 已在 DESIGN_SESSION_TYPE_TOOLS 里
    const tools = computeDesignSessionTypeTools(["write"]);
    const writeCount = tools.filter((t) => t === "write").length;
    expect(writeCount).toBe(1);
  });
});

describe("computeSessionTypeTools", () => {
  it("design → computeDesignSessionTypeTools", () => {
    const design = computeSessionTypeTools("design", ["read"]);
    expect(design).toContain("read");
    expect(design).toContain("write");
    expect(design).toContain("edit");
  });

  it("code → computeCodeSessionTypeTools", () => {
    const code = computeSessionTypeTools("code", ["write", "bash"]);
    expect(code).toEqual(["write", "bash"]);
  });
});

describe("DESIGN_SESSION_TYPE_TOOLS 契约", () => {
  it("不包含 write_plan", () => {
    expect(DESIGN_SESSION_TYPE_TOOLS).not.toContain(WRITE_PLAN_TOOL);
  });

  it("包含全部 readonly core", () => {
    for (const t of READONLY_CORE_TOOLS) {
      expect(DESIGN_SESSION_TYPE_TOOLS).toContain(t);
    }
  });

  it("包含 write / edit (guard 负责路径检查)", () => {
    expect(DESIGN_SESSION_TYPE_TOOLS).toContain("write");
    expect(DESIGN_SESSION_TYPE_TOOLS).toContain("edit");
  });
});

describe("mode + type 组合契约 (与 plan-tools.computeModeToolsForType 一致)", () => {
  it("代码常量: PLAN_MODE_OPTIONAL_READONLY_TOOLS 存在且非空", () => {
    expect(PLAN_MODE_OPTIONAL_READONLY_TOOLS.length).toBeGreaterThan(0);
  });
});
