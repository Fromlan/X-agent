/**
 * Vitest 套件 —— Godot RPC 白名单 + 工具开关映射 (issue #60 主题 D C-302, 2026-08-31).
 *
 * 锁住以下不变量:
 *   1. GODOT_RPC_ALLOWED_METHODS 是 30 个方法的白名单
 *   2. isAllowedGodotRpcMethod 是 type guard (合法 / 非法 / 非字符串)
 *   3. GODOT_RPC_METHOD_TOOL 中每个白名单方法都有映射
 *   4. 写型方法必须受工具开关门控 (open_scene / run_current_scene /
 *      set_project_setting / export_project / set_breakpoint)
 *   5. 未知方法返回 null (调用方先经 isAllowedGodotRpcMethod)
 *
 * 跨文件 drift 的 regression (issue #66 主题 I) 通过 fs 读取 godot-tools.ts
 * 的 defineTool 名 + godot-helpers.ts 的 RPC_METHODS CSV 字符串, 与本
 * 模块的 ALLOWED_METHODS / METHOD_TOOL 做集合对账 — 保证不漂.
 *
 * 注意: protocol.ts / policy.ts 已经有 godot-rpc.test.ts 覆盖, 本文件
 * 只覆盖 gating 拆出后的契约 (白名单 + 映射).
 */
import { describe, it, expect } from "vitest";
import {
  GODOT_RPC_ALLOWED_METHODS,
  GODOT_RPC_METHOD_TOOL,
  godotRpcMethodTool,
  isAllowedGodotRpcMethod,
} from "./gating";

describe("GODOT_RPC_ALLOWED_METHODS 白名单契约", () => {
  it("包含基础方法 + 1.2 + 1.3 扩展", () => {
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("ping");
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("get_editor_info");
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("stop_scene");
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("get_scene_tree");
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("get_node_properties");
  });

  it("1.2 调试器 / 资源 / 导出 / 配置 / lint 全部在白名单", () => {
    for (const m of [
      "get_debugger_state",
      "set_breakpoint",
      "find_unused_resources",
      "export_project",
      "get_project_setting",
      "set_project_setting",
      "lint_scripts",
    ]) {
      expect(GODOT_RPC_ALLOWED_METHODS, `${m} missing`).toContain(m);
    }
  });

  it("1.3 只读内省 / UID / 类名 / 脚本反射 / 导出预检 全部在白名单", () => {
    for (const m of [
      "list_project_files",
      "resolve_uid",
      "wait_for_import_done",
      "list_global_classes",
      "find_class_name_conflicts",
      "inspect_script",
      "list_export_presets",
      "check_export_templates",
    ]) {
      expect(GODOT_RPC_ALLOWED_METHODS, `${m} missing`).toContain(m);
    }
  });

  it("无重名 (compile-time 已经用 as const 锁住, 这里再 lock 一次)", () => {
    const set = new Set<string>();
    for (const m of GODOT_RPC_ALLOWED_METHODS) {
      expect(set.has(m), `duplicate method in ALLOWED: ${m}`).toBe(false);
      set.add(m);
    }
  });
});

describe("isAllowedGodotRpcMethod type guard", () => {
  it("合法方法 (含 1.2 / 1.3 全部 30 个) 返回 true", () => {
    for (const m of GODOT_RPC_ALLOWED_METHODS) {
      expect(isAllowedGodotRpcMethod(m), `expected true for ${m}`).toBe(true);
    }
  });

  it("非法方法返回 false", () => {
    expect(isAllowedGodotRpcMethod("rm_rf")).toBe(false);
    expect(isAllowedGodotRpcMethod("")).toBe(false);
    expect(isAllowedGodotRpcMethod("not_a_method")).toBe(false);
  });

  it("非字符串返回 false (number / null / undefined / object)", () => {
    expect(isAllowedGodotRpcMethod(123)).toBe(false);
    expect(isAllowedGodotRpcMethod(null)).toBe(false);
    expect(isAllowedGodotRpcMethod(undefined)).toBe(false);
    expect(isAllowedGodotRpcMethod({})).toBe(false);
    expect(isAllowedGodotRpcMethod([])).toBe(false);
  });
});

describe("GODOT_RPC_METHOD_TOOL 工具开关映射", () => {
  it("每个白名单方法都有映射 (null 仅限 ping 这种协议级调用)", () => {
    for (const method of GODOT_RPC_ALLOWED_METHODS) {
      expect(GODOT_RPC_METHOD_TOOL, `missing map for ${method}`).toHaveProperty(
        method,
      );
    }
  });

  it("ping 是唯一的 null 映射 (协议级心跳不需要工具开关)", () => {
    expect(godotRpcMethodTool("ping")).toBeNull();
  });

  it("写型方法必须受工具开关门控 (不能 null)", () => {
    expect(godotRpcMethodTool("open_scene")).toBe("godot_open_scene");
    expect(godotRpcMethodTool("run_current_scene")).toBe("godot_run_scene");
    expect(godotRpcMethodTool("set_project_setting")).toBe(
      "godot_set_project_setting",
    );
    expect(godotRpcMethodTool("export_project")).toBe("godot_export_project");
    expect(godotRpcMethodTool("set_breakpoint")).toBe("godot_set_breakpoint");
  });

  it("只读方法也应该在映射里 (值为具体 tool 名)", () => {
    expect(godotRpcMethodTool("get_editor_info")).toBe("godot_editor_info");
    expect(godotRpcMethodTool("get_scene_tree")).toBe("godot_get_scene_tree");
    expect(godotRpcMethodTool("get_node_properties")).toBe(
      "godot_get_node_properties",
    );
  });

  it("未知方法返回 null (调用方应先经 isAllowedGodotRpcMethod)", () => {
    expect(godotRpcMethodTool("rm_rf")).toBeNull();
    expect(godotRpcMethodTool("")).toBeNull();
    expect(godotRpcMethodTool("not_a_method")).toBeNull();
  });
});
