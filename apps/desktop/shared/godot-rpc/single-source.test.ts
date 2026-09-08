/**
 * 主题 I (issue #66 C-406) — RPC method 列表 single-source of truth cross-check.
 *
 * 锁住以下不变量:
 *   1. `GODOT_RPC_METHOD_NAMES` (protocol.ts) 是 30 个方法的真源
 *   2. `GODOT_RPC_ALLOWED_METHODS` (gating.ts) 仍是同一数组的 alias (向后兼容)
 *   3. `gating.ts` 整个白名单 / type guard 都基于 protocol.ts
 *   4. `godot-tools.ts` 显式消费 `GODOT_RPC_METHOD_NAMES` (不再 hardcode)
 *   5. `godot-helpers.ts` 改从 `apps/desktop/shared/godot-rpc/protocol`
 *      消费同一源, 不再 hardcode CSV (issue #66 acceptance)
 *   6. `plugin.gd` 的 `match method:` case 名 ⊆ `GODOT_RPC_METHOD_NAMES`
 *      (GDScript 端是最后 1+1 处, 跨语言 drift 必报)
 *
 * 任意一处 drift, vitest 立即报错, 防 issue C-406 复发.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  GODOT_RPC_ALLOWED_METHODS,
  GODOT_RPC_METHOD_NAMES,
} from "../godot-rpc";

const APPS_DESKTOP = resolve(__dirname, "..", "..");
const REPO_ROOT = resolve(APPS_DESKTOP, "..", "..");

const GODOT_TOOLS_PATH = join(APPS_DESKTOP, "electron", "agent", "godot-tools.ts");
const GODOT_HELPERS_PATH = join(
  REPO_ROOT,
  "packages",
  "godot-pi",
  "extensions",
  "godot-helpers.ts",
);
const PLUGIN_GD_PATH = join(
  REPO_ROOT,
  "packages",
  "godot-editor-rpc",
  "addons",
  "x_agent_rpc",
  "plugin.gd",
);

function extractPluginGdMethods(src: string): string[] {
  // 截到 `match method:` 之后, 在 `match method:` 块的 `_:` 默认分支之前
  // (我们只关心已注册的方法 case, 不关心 default fall-through).
  const startIdx = src.indexOf("match method:");
  if (startIdx < 0) return [];
  // 找下一个 `_:` 默认 case 终止 (4-space 缩进 GDScript match case)
  const endMarker = src.indexOf("\n\t\t_:", startIdx);
  if (endMarker < 0) return [];
  const block = src.substring(startIdx, endMarker);
  // match case 形如 `\t\t"name":` (4-space 缩进的子 case 视作嵌套分支,
  // 但 Godot 不支持嵌套 match, 4 空格不会出现在 method: 顶层分支里)
  const caseRe = /^\t\t"([a-z_][a-z0-9_]*)":/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(block)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

function extractHelpersImportPath(src: string): string | null {
  // `import { GODOT_RPC_METHOD_NAMES } from "..."`
  const m = src.match(
    /import\s*\{\s*GODOT_RPC_METHOD_NAMES\s*\}\s*from\s*["']([^"']+)["']/,
  );
  return m ? m[1]! : null;
}

describe("GODOT_RPC_METHOD_NAMES single-source 契约 (主题 I)", () => {
  it("protocol.ts 暴露 28 个方法 (13 基础 + 7 v1.2 + 8 v1.3)", () => {
    expect(GODOT_RPC_METHOD_NAMES.length).toBe(28);
  });

  it("GODOT_RPC_ALLOWED_METHODS 是同一数组的 alias (向后兼容)", () => {
    // 不变量: 别名指向同一 tuple, 改了 NAMES 后 ALLOWED 自动同步.
    expect(GODOT_RPC_ALLOWED_METHODS).toBe(GODOT_RPC_METHOD_NAMES);
  });

  it("方法名集合无重名", () => {
    const seen = new Set<string>();
    for (const m of GODOT_RPC_METHOD_NAMES) {
      expect(seen.has(m), `duplicate method in GODOT_RPC_METHOD_NAMES: ${m}`).toBe(
        false,
      );
      seen.add(m);
    }
  });

  it("方法名全部 snake_case 且不为空", () => {
    for (const m of GODOT_RPC_METHOD_NAMES) {
      expect(m).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe("godot-helpers.ts 改消费 shared schema (主题 I-2 acceptance)", () => {
  it("文件存在", () => {
    expect(existsSync(GODOT_HELPERS_PATH)).toBe(true);
  });

  it("不再 hardcode RPC_METHODS 字符串字面量", () => {
    const src = readFileSync(GODOT_HELPERS_PATH, "utf8");
    // 老实现: `const RPC_METHODS = "ping, " + "get_editor_info, ...` 这种
    // 字面量串串. 新实现应该只用 join(GODOT_RPC_METHOD_NAMES).
    // 排除注释里的引用.
    const codeOnly = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    expect(
      /const\s+RPC_METHODS\s*=\s*["']/.test(codeOnly),
      "godot-helpers.ts 仍硬编码 RPC_METHODS 字符串; 应改为 GODOT_RPC_METHOD_NAMES.join()",
    ).toBe(false);
    expect(
      /GODOT_RPC_METHOD_NAMES\.join/.test(src),
      "godot-helpers.ts 应调用 GODOT_RPC_METHOD_NAMES.join(...)",
    ).toBe(true);
  });

  it("import 路径指向 apps/desktop/shared/godot-rpc/protocol", () => {
    const src = readFileSync(GODOT_HELPERS_PATH, "utf8");
    const importPath = extractHelpersImportPath(src);
    expect(importPath, "godot-helpers.ts 必须 import GODOT_RPC_METHOD_NAMES").not.toBeNull();
    expect(importPath).toMatch(
      /\/shared\/godot-rpc\/protocol$/,
      `godot-helpers.ts 应 import 自 apps/desktop/shared/godot-rpc/protocol, 实得 "${importPath}"`,
    );
  });

  it("dynamic import 能 resolve (依赖 + 路径都对)", async () => {
    // 用 file:// URL 跑 dynamic import, 让 vitest 在解析 godot-helpers.ts
    // 时把 typebox / Pi ext 都拉进来. 如果 import 路径或 peer dep 链断了,
    // 这里直接抛错.
    const fileUrl = new URL(`file:///${GODOT_HELPERS_PATH.replace(/\\/g, "/")}`);
    const mod = (await import(fileUrl.href)) as {
      default?: unknown;
    };
    expect(typeof mod.default).toBe("function");
  });
});

describe("plugin.gd match method: case 名 vs GODOT_RPC_METHOD_NAMES (主题 I 跨语言 drift)", () => {
  it("plugin.gd 存在", () => {
    expect(existsSync(PLUGIN_GD_PATH)).toBe(true);
  });

  it("plugin.gd 中 match method: case 名 ⊆ GODOT_RPC_METHOD_NAMES", () => {
    const src = readFileSync(PLUGIN_GD_PATH, "utf8");
    const gdMethods = extractPluginGdMethods(src);
    expect(gdMethods.length, "plugin.gd match method: 至少 1 个 case").toBeGreaterThan(0);
    const allowed = new Set<string>(GODOT_RPC_METHOD_NAMES);
    for (const m of gdMethods) {
      expect(
        allowed.has(m),
        `plugin.gd 注册了 "${m}", 但不在 GODOT_RPC_METHOD_NAMES; 加到 protocol.ts 单一源`,
      ).toBe(true);
    }
  });

  it("plugin.gd 覆盖所有 1.x 扩展方法 (调试器/资源/导出/UID/类名/反射/导出预检)", () => {
    const src = readFileSync(PLUGIN_GD_PATH, "utf8");
    const gdMethods = new Set(extractPluginGdMethods(src));
    for (const m of [
      "get_debugger_state",
      "set_breakpoint",
      "find_unused_resources",
      "export_project",
      "get_project_setting",
      "set_project_setting",
      "lint_scripts",
      "list_project_files",
      "resolve_uid",
      "wait_for_import_done",
      "list_global_classes",
      "find_class_name_conflicts",
      "inspect_script",
      "list_export_presets",
      "check_export_templates",
    ]) {
      expect(
        gdMethods.has(m),
        `plugin.gd match method: 缺 "${m}"`,
      ).toBe(true);
    }
  });
});

describe("godot-tools.ts 显式消费 shared schema (主题 I-1)", () => {
  it("文件存在", () => {
    expect(existsSync(GODOT_TOOLS_PATH)).toBe(true);
  });

  it("顶部 import 了 GODOT_RPC_METHOD_NAMES (不依赖 type-only re-export)", () => {
    const src = readFileSync(GODOT_TOOLS_PATH, "utf8");
    expect(
      /import\s*\{[^}]*\bGODOT_RPC_METHOD_NAMES\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/shared\/godot-rpc["']/.test(
        src,
      ),
      "godot-tools.ts 应 import GODOT_RPC_METHOD_NAMES 自 shared/godot-rpc",
    ).toBe(true);
  });
});
