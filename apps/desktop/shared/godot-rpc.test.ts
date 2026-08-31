/**
 * Vitest 套件 —— 锁住 Godot RPC 协议常量与类型守卫。
 * 覆盖 ROADMAP 1.2（tool 扩展）所需的协议面。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  GODOT_LIST_FILES_DEFAULT_LIMIT,
  GODOT_LIST_FILES_MAX_LIMIT,
  GODOT_RPC_ALLOWED_METHODS,
  GODOT_RPC_DEFAULT_PORT,
  GODOT_RPC_DEFAULT_WAIT_MS,
  GODOT_RPC_MAX_WAIT_MS,
  GODOT_RPC_BASE_TIMEOUT_MS,
  GODOT_RPC_EXPORT_GRACE_MS,
  GODOT_RPC_GRACE_PERIOD_MS,
  GODOT_WAIT_DEFAULT_TIMEOUT_MS,
  GODOT_WAIT_MAX_TIMEOUT_MS,
  GODOT_RPC_METHOD_TOOL,
  clampGodotListLimit,
  clampGodotRunWaitMs,
  clampGodotWaitMs,
  godotRpcMethodTool,
  godotRpcTimeoutMs,
  isAllowedGodotRpcMethod,
  type GodotRpcCall,
} from "./godot-rpc";

describe("GODOT_RPC 常量", () => {
  it("默认端口 8765", () => {
    expect(GODOT_RPC_DEFAULT_PORT).toBe(8765);
  });

  it("默认等待 3000ms，上限 15000ms", () => {
    expect(GODOT_RPC_DEFAULT_WAIT_MS).toBe(3000);
    expect(GODOT_RPC_MAX_WAIT_MS).toBe(15000);
  });

  it("基础超时 8000ms，宽限期 8000ms", () => {
    expect(GODOT_RPC_BASE_TIMEOUT_MS).toBe(8000);
    expect(GODOT_RPC_GRACE_PERIOD_MS).toBe(8000);
  });

  it("1.3 wait/list 默认值与上限", () => {
    expect(GODOT_WAIT_DEFAULT_TIMEOUT_MS).toBe(30_000);
    expect(GODOT_WAIT_MAX_TIMEOUT_MS).toBe(60_000);
    expect(GODOT_LIST_FILES_DEFAULT_LIMIT).toBe(500);
    expect(GODOT_LIST_FILES_MAX_LIMIT).toBe(5000);
  });

  it("方法白名单包含所有当前方法 + 新增只读方法", () => {
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("ping");
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("get_editor_info");
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("stop_scene");
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("get_scene_tree");
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("get_node_properties");
  });

  it("1.2 剩余方法全部进入白名单（调试器/资源/导出/配置/lint）", () => {
    for (const m of [
      "get_debugger_state",
      "set_breakpoint",
      "find_unused_resources",
      "export_project",
      "get_project_setting",
      "set_project_setting",
      "lint_scripts",
    ]) {
      expect(GODOT_RPC_ALLOWED_METHODS).toContain(m);
    }
  });

  it("1.3 八个只读内省 / UID / 类名 / 脚本反射 / 导出预检方法均在白名单", () => {
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
      expect(GODOT_RPC_ALLOWED_METHODS).toContain(m);
    }
  });
});

describe("clampGodotRunWaitMs", () => {
  it("undefined / null 走默认值", () => {
    expect(clampGodotRunWaitMs(undefined)).toBe(GODOT_RPC_DEFAULT_WAIT_MS);
  });

  it("负数走默认值", () => {
    expect(clampGodotRunWaitMs(-1)).toBe(GODOT_RPC_DEFAULT_WAIT_MS);
  });

  it("正常值原样返回", () => {
    expect(clampGodotRunWaitMs(5000)).toBe(5000);
  });

  it("超过上限被截断", () => {
    expect(clampGodotRunWaitMs(GODOT_RPC_MAX_WAIT_MS + 1000)).toBe(
      GODOT_RPC_MAX_WAIT_MS,
    );
  });
});

describe("clampGodotWaitMs", () => {
  it("undefined / 非有限数走默认", () => {
    expect(clampGodotWaitMs(undefined)).toBe(GODOT_WAIT_DEFAULT_TIMEOUT_MS);
    expect(clampGodotWaitMs(null)).toBe(GODOT_WAIT_DEFAULT_TIMEOUT_MS);
  });

  it("负数走默认值（30s）", () => {
    expect(clampGodotWaitMs(-10)).toBe(GODOT_WAIT_DEFAULT_TIMEOUT_MS);
  });

  it("超过上限被截断到上限", () => {
    expect(clampGodotWaitMs(GODOT_WAIT_MAX_TIMEOUT_MS + 5000)).toBe(
      GODOT_WAIT_MAX_TIMEOUT_MS,
    );
  });

  it("0 原样保留为 0（语义：不等立即返回）", () => {
    expect(clampGodotWaitMs(0)).toBe(0);
  });

  it("合法值原样返回", () => {
    expect(clampGodotWaitMs(15000)).toBe(15000);
  });
});

describe("clampGodotListLimit", () => {
  it("undefined / null / 0 走默认", () => {
    expect(clampGodotListLimit(undefined)).toBe(GODOT_LIST_FILES_DEFAULT_LIMIT);
    expect(clampGodotListLimit(null)).toBe(GODOT_LIST_FILES_DEFAULT_LIMIT);
    expect(clampGodotListLimit(0)).toBe(GODOT_LIST_FILES_DEFAULT_LIMIT);
  });

  it("负数走默认", () => {
    expect(clampGodotListLimit(-1)).toBe(GODOT_LIST_FILES_DEFAULT_LIMIT);
  });

  it("超过上限被截断到上限", () => {
    expect(clampGodotListLimit(99999)).toBe(GODOT_LIST_FILES_MAX_LIMIT);
  });

  it("合法值原样保留", () => {
    expect(clampGodotListLimit(120)).toBe(120);
  });
});

describe("godotRpcTimeoutMs", () => {
  it("非 run/play 调用返回基础超时", () => {
    const call: GodotRpcCall = { method: "ping" };
    expect(godotRpcTimeoutMs(call)).toBe(GODOT_RPC_BASE_TIMEOUT_MS);
  });

  it("run_current_scene 含 wait_ms 时返回基础 + wait_ms", () => {
    const call: GodotRpcCall = { method: "run_current_scene", wait_ms: 5000 };
    expect(godotRpcTimeoutMs(call)).toBe(GODOT_RPC_BASE_TIMEOUT_MS + 5000);
  });

  it("1.2 新增的 get_scene_tree 不增加 wait", () => {
    const call: GodotRpcCall = {
      method: "get_scene_tree",
      path: "res://main.tscn",
    };
    expect(godotRpcTimeoutMs(call)).toBe(GODOT_RPC_BASE_TIMEOUT_MS);
  });

  it("export_project 使用 5 分钟超时档 + 启动余量（C4：保证插件先收尾）", () => {
    const call: GodotRpcCall = {
      method: "export_project",
      preset: "Windows Desktop",
      output_dir: "C:/out",
    };
    expect(godotRpcTimeoutMs(call)).toBe(
      5 * 60_000 + GODOT_RPC_EXPORT_GRACE_MS,
    );
  });

  it("find_unused_resources / lint_scripts 使用 4 倍基础超时档", () => {
    const unused: GodotRpcCall = { method: "find_unused_resources" };
    expect(godotRpcTimeoutMs(unused)).toBe(GODOT_RPC_BASE_TIMEOUT_MS * 4);
    const lint: GodotRpcCall = { method: "lint_scripts", paths: ["res://a.gd"] };
    expect(godotRpcTimeoutMs(lint)).toBe(GODOT_RPC_BASE_TIMEOUT_MS * 4);
  });

  it("配置读写 / 调试器 / 断点走基础超时", () => {
    const get: GodotRpcCall = { method: "get_project_setting", key: "x" };
    expect(godotRpcTimeoutMs(get)).toBe(GODOT_RPC_BASE_TIMEOUT_MS);
    const set: GodotRpcCall = {
      method: "set_project_setting",
      key: "x",
      value: 1,
    };
    expect(godotRpcTimeoutMs(set)).toBe(GODOT_RPC_BASE_TIMEOUT_MS);
    const dbg: GodotRpcCall = { method: "get_debugger_state" };
    expect(godotRpcTimeoutMs(dbg)).toBe(GODOT_RPC_BASE_TIMEOUT_MS);
  });

  it("1.3 wait_for_import_done 使用 timeout_ms + 基础超时", () => {
    const call: GodotRpcCall = {
      method: "wait_for_import_done",
      paths: ["res://a.png"],
      timeout_ms: 10000,
    };
    expect(godotRpcTimeoutMs(call)).toBe(GODOT_RPC_BASE_TIMEOUT_MS + 10000);
  });

  it("1.3 列表 / 扫描 / 反射类走 4 倍基础超时档", () => {
    const cases: GodotRpcCall[] = [
      { method: "list_project_files" },
      { method: "find_class_name_conflicts" },
      { method: "inspect_script", path: "res://a.gd" },
    ];
    for (const c of cases) {
      expect(godotRpcTimeoutMs(c)).toBe(GODOT_RPC_BASE_TIMEOUT_MS * 4);
    }
  });

  it("1.3 resolve_uid / list_global_classes / 导出预检走基础超时", () => {
    for (const c of [
      { method: "resolve_uid", uid: "uid://abc" },
      { method: "list_global_classes" },
      { method: "list_export_presets" },
      { method: "check_export_templates" },
    ] as GodotRpcCall[]) {
      expect(godotRpcTimeoutMs(c)).toBe(GODOT_RPC_BASE_TIMEOUT_MS);
    }
  });
});

describe("isAllowedGodotRpcMethod", () => {
  it("合法方法返回 true（含 1.3 新增 8 个）", () => {
    expect(isAllowedGodotRpcMethod("ping")).toBe(true);
    expect(isAllowedGodotRpcMethod("get_scene_tree")).toBe(true);
    expect(isAllowedGodotRpcMethod("export_project")).toBe(true);
    expect(isAllowedGodotRpcMethod("lint_scripts")).toBe(true);
    expect(isAllowedGodotRpcMethod("list_project_files")).toBe(true);
    expect(isAllowedGodotRpcMethod("resolve_uid")).toBe(true);
    expect(isAllowedGodotRpcMethod("wait_for_import_done")).toBe(true);
    expect(isAllowedGodotRpcMethod("inspect_script")).toBe(true);
    expect(isAllowedGodotRpcMethod("check_export_templates")).toBe(true);
  });

  it("非法方法返回 false", () => {
    expect(isAllowedGodotRpcMethod("rm_rf")).toBe(false);
    expect(isAllowedGodotRpcMethod("")).toBe(false);
  });

  it("非字符串返回 false", () => {
    expect(isAllowedGodotRpcMethod(123)).toBe(false);
    expect(isAllowedGodotRpcMethod(null)).toBe(false);
    expect(isAllowedGodotRpcMethod(undefined)).toBe(false);
    expect(isAllowedGodotRpcMethod({})).toBe(false);
  });
});

describe("GODOT_RPC_METHOD_TOOL 工具开关映射", () => {
  it("每个白名单方法都有映射（null 仅限 ping）", () => {
    for (const method of GODOT_RPC_ALLOWED_METHODS) {
      expect(GODOT_RPC_METHOD_TOOL).toHaveProperty(method);
    }
    expect(godotRpcMethodTool("ping")).toBeNull();
  });

  it("写型方法必须受工具开关门控", () => {
    expect(godotRpcMethodTool("open_scene")).toBe("godot_open_scene");
    expect(godotRpcMethodTool("run_current_scene")).toBe("godot_run_scene");
    expect(godotRpcMethodTool("set_project_setting")).toBe(
      "godot_set_project_setting",
    );
    expect(godotRpcMethodTool("export_project")).toBe("godot_export_project");
    expect(godotRpcMethodTool("set_breakpoint")).toBe("godot_set_breakpoint");
  });

  it("未知方法返回 null（调用方先经 isAllowedGodotRpcMethod）", () => {
    expect(godotRpcMethodTool("rm_rf")).toBeNull();
  });
});

/**
 * 跨文件 drift check (issue #66 主题 I, 2026-08-31).
 *
 * 之前 GODOT_RPC_METHOD_TOOL 与 3 处 hardcoded 实现可能 drift:
 * - `electron/agent/godot-tools.ts` 27 个 defineTool name 字符串
 * - `packages/godot-pi/extensions/godot-helpers.ts` RPC_METHODS CSV 字符串
 * (plugin.gd GDScript 端留 plugin 子仓, 不在本测试范围, 计划留给 GDScript
 *  stub 生成 — 计划里说"超出本 issue 范围")
 *
 * 一旦 TS 端 drift, vitest 立即报错.
 */

const APPS_DESKTOP = join(process.cwd());
const GODOT_TOOLS_PATH = join(APPS_DESKTOP, "electron", "agent", "godot-tools.ts");
const GODOT_HELPERS_PATH = join(
  APPS_DESKTOP,
  "..",
  "..",
  "packages",
  "godot-pi",
  "extensions",
  "godot-helpers.ts",
);

function extractGodotToolNames(src: string): string[] {
  // 匹配 `name: "godot_xxx"` (defineTool 第 1 个字段) — 排除非 string 字面量
  const re = /name:\s*"(godot_[a-z0-9_]+)"/g;
  const out: string[] = [];
  for (const m of src.matchAll(re)) out.push(m[1]!);
  return out;
}

function extractHelpersRpcMethods(src: string): string[] {
  // godot-helpers.ts 用 `"a, " + "b, " + ... "c";` 拼接. 简单 regex 会被前面的 import 末尾 `";` 截断.
  // 策略: 找 `const RPC_METHODS` 之后到 `;` 之前所有 string literal, 拼接.
  const start = src.indexOf("const RPC_METHODS");
  if (start < 0) return [];
  // 截到 `;` 终止 (只取这一句)
  const semi = src.indexOf(";", start);
  if (semi < 0) return [];
  const stmt = src.substring(start, semi + 1);
  // 提取 stmt 内所有 "..." 段
  const stringParts: string[] = [];
  const stringRe = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = stringRe.exec(stmt)) !== null) {
    stringParts.push(m[1]!);
  }
  return stringParts.join(",").split(",").map((s) => s.trim()).filter(Boolean);
}

describe("godot-tools.ts 工具名 vs GODOT_RPC_METHOD_TOOL (主题 I 跨文件 drift)", () => {
  it("所有 godot_xxx defineTool 名都注册在 GODOT_RPC_METHOD_TOOL (反向映射不漏)", () => {
    const src = readFileSync(GODOT_TOOLS_PATH, "utf8");
    const names = extractGodotToolNames(src);
    expect(names.length).toBeGreaterThan(0);
    // 收集 GODOT_RPC_METHOD_TOOL 所有 value
    const registeredTools = new Set(
      Object.values(GODOT_RPC_METHOD_TOOL).filter(
        (v): v is string => v !== null,
      ),
    );
    for (const name of names) {
      expect(
        registeredTools.has(name),
        `godot-tools.ts "${name}" 未注册在 GODOT_RPC_METHOD_TOOL`,
      ).toBe(true);
    }
  });
});

describe("godot-helpers.ts RPC_METHODS vs GODOT_RPC_ALLOWED_METHODS (主题 I 跨包 drift)", () => {
  it("CSV 字符串集合 = GODOT_RPC_ALLOWED_METHODS 集合 (无 drift)", () => {
    const src = readFileSync(GODOT_HELPERS_PATH, "utf8");
    const csvMethods = extractHelpersRpcMethods(src);
    expect(csvMethods.length).toBe(GODOT_RPC_ALLOWED_METHODS.length);
    const csvSet = new Set(csvMethods);
    for (const m of GODOT_RPC_ALLOWED_METHODS) {
      expect(
        csvSet.has(m),
        `godot-helpers.ts RPC_METHODS 缺 "${m}"`,
      ).toBe(true);
    }
    for (const m of csvMethods) {
      expect(
        (GODOT_RPC_ALLOWED_METHODS as readonly string[]).includes(m),
        `godot-helpers.ts RPC_METHODS 多出 "${m}" (不在 GODOT_RPC_ALLOWED_METHODS)`,
      ).toBe(true);
    }
  });
});
