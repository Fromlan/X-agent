/**
 * Vitest 套件 —— mode-tools 模式工具白名单常量。
 * 锁住 Ask / Plan 模式的只读工具集与 write_plan 归属，防误删。
 */
import { describe, it, expect } from "vitest";
import {
  WRITE_PLAN_TOOL,
  READONLY_CORE_TOOLS,
  PLAN_MODE_CORE_TOOLS,
  PLAN_MODE_OPTIONAL_READONLY_TOOLS,
} from "./mode-tools";

describe("mode-tools allowlists", () => {
  it("write_plan 是独立常量且属于 Plan 核心工具", () => {
    expect(WRITE_PLAN_TOOL).toBe("write_plan");
    expect(PLAN_MODE_CORE_TOOLS).toContain(WRITE_PLAN_TOOL);
  });

  it("核心只读工具含 read/grep/find/ls/bash", () => {
    for (const t of ["read", "grep", "find", "ls", "bash"]) {
      expect(READONLY_CORE_TOOLS).toContain(t);
    }
    // write_plan 不在核心只读里（自定义工具）
    expect(READONLY_CORE_TOOLS).not.toContain(WRITE_PLAN_TOOL);
  });

  it("Plan 核心 = 只读核心 + write_plan", () => {
    expect(PLAN_MODE_CORE_TOOLS).toEqual([
      ...READONLY_CORE_TOOLS,
      WRITE_PLAN_TOOL,
    ]);
  });

  it("可选用 Godot 只读工具均为 godot_ 前缀且不含写型工具", () => {
    for (const t of PLAN_MODE_OPTIONAL_READONLY_TOOLS) {
      expect(t).toMatch(/^godot_/);
    }
    expect(PLAN_MODE_OPTIONAL_READONLY_TOOLS).not.toContain("godot_set_project_setting");
    expect(PLAN_MODE_OPTIONAL_READONLY_TOOLS).not.toContain("godot_set_breakpoint");
    expect(PLAN_MODE_OPTIONAL_READONLY_TOOLS).not.toContain("godot_export_project");
  });

  it("1.2 只读工具已入白名单", () => {
    expect(PLAN_MODE_OPTIONAL_READONLY_TOOLS).toEqual(
      expect.arrayContaining([
        "godot_get_scene_tree",
        "godot_get_node_properties",
        "godot_get_debugger_state",
        "godot_find_unused_resources",
        "godot_get_project_setting",
        "godot_lint_scripts",
      ]),
    );
  });
});
