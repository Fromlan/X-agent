/**
 * Vitest suite — 工具注册表 derive + 并集边界 (issue #60 主题 D C-306, 2026-08-31).
 *
 * 锁住以下不变量:
 *   1. AVAILABLE_TOOLS / GODOT_TOOLS 是 source-of-truth (2 个 const 数组)
 *   2. ALL_TOGGLEABLE_TOOLS = AVAILABLE ∪ GODOT, 无重名, 长度 = sum
 *   3. SESSION_TOOL_REGISTRY = ALL_TOGGLEABLE + write_plan, 无重名
 *   4. typecheck 立即捕获"加了工具忘更新某 list" — BuiltinToolName /
 *      GodotToolName 类型与数组同步
 *   5. deriveToolList 是纯函数 / 拒绝重复 / 保留顺序
 *
 * 跨文件 drift 的回归 (issue #60 主题 D C-306 + #66 主题 I 跨文件) 在
 * ./../godot-rpc/gating.test.ts 中通过 filesystem 读取 godot-tools.ts 的
 * defineTool 列表做对账.
 */
import { describe, it, expect } from "vitest";
import { AVAILABLE_TOOLS, type BuiltinToolName } from "./available";
import { GODOT_TOOLS, type GodotToolName } from "./godot";
import {
  ALL_TOGGLEABLE_TOOLS,
  SESSION_TOOL_REGISTRY,
} from "./derived";
import { deriveToolList } from "./derive";
import { WRITE_PLAN_TOOL } from "../mode-tools";

describe("source-of-truth arrays", () => {
  it("AVAILABLE_TOOLS / GODOT_TOOLS 各自非空", () => {
    expect(AVAILABLE_TOOLS.length).toBeGreaterThan(0);
    expect(GODOT_TOOLS.length).toBeGreaterThan(0);
  });

  it("builtin tools must not have godot_ prefix (naming convention)", () => {
    for (const t of AVAILABLE_TOOLS) {
      expect(t.startsWith("godot_"), `builtin must not have godot_ prefix: ${t}`).toBe(
        false,
      );
    }
  });

  it("Godot tools must have godot_ prefix (naming convention)", () => {
    for (const t of GODOT_TOOLS) {
      expect(t.startsWith("godot_"), `Godot tool must have godot_ prefix: ${t}`).toBe(
        true,
      );
    }
  });
});

describe("ALL_TOGGLEABLE_TOOLS = AVAILABLE ∪ GODOT (derive)", () => {
  it("has no duplicate (union)", () => {
    const set = new Set<string>();
    for (const t of ALL_TOGGLEABLE_TOOLS) {
      expect(set.has(t), `ALL_TOGGLEABLE_TOOLS has duplicate: ${t}`).toBe(false);
      set.add(t);
    }
  });

  it("length = AVAILABLE.length + GODOT.length (no silent loss)", () => {
    expect(ALL_TOGGLEABLE_TOOLS.length).toBe(
      AVAILABLE_TOOLS.length + GODOT_TOOLS.length,
    );
  });

  it("contains every AVAILABLE entry in order (AVAILABLE first)", () => {
    let cursor = 0;
    for (const t of AVAILABLE_TOOLS) {
      const found = ALL_TOGGLEABLE_TOOLS.indexOf(t, cursor);
      expect(found, `ALL_TOGGLEABLE_TOOLS missing builtin ${t}`).toBeGreaterThanOrEqual(
        cursor,
      );
      cursor = found + 1;
    }
  });

  it("contains every GODOT entry in order (GODOT after)", () => {
    const godotStart = ALL_TOGGLEABLE_TOOLS.length - GODOT_TOOLS.length;
    for (let i = 0; i < GODOT_TOOLS.length; i++) {
      expect(ALL_TOGGLEABLE_TOOLS[godotStart + i]).toBe(GODOT_TOOLS[i]);
    }
  });
});

describe("SESSION_TOOL_REGISTRY = ALL_TOGGLEABLE + write_plan (derive)", () => {
  it("has no duplicate", () => {
    const set = new Set<string>();
    for (const t of SESSION_TOOL_REGISTRY) {
      expect(set.has(t), `SESSION_TOOL_REGISTRY has duplicate: ${t}`).toBe(false);
      set.add(t);
    }
  });

  it("length = ALL_TOGGLEABLE + 1 (write_plan)", () => {
    expect(SESSION_TOOL_REGISTRY.length).toBe(
      ALL_TOGGLEABLE_TOOLS.length + 1,
    );
  });

  it("write_plan is appended at the end", () => {
    expect(SESSION_TOOL_REGISTRY[SESSION_TOOL_REGISTRY.length - 1]).toBe(
      WRITE_PLAN_TOOL,
    );
  });

  it("prefix equals ALL_TOGGLEABLE_TOOLS in order", () => {
    for (let i = 0; i < ALL_TOGGLEABLE_TOOLS.length; i++) {
      expect(SESSION_TOOL_REGISTRY[i]).toBe(ALL_TOGGLEABLE_TOOLS[i]);
    }
  });
});

describe("BuiltinToolName / GodotToolName type narrows the array (compile-time)", () => {
  it("type is the first item's narrow", () => {
    // These two lines passing typecheck are the test — vitest is just here
    // to ensure the file loads.
    const builtin: BuiltinToolName = AVAILABLE_TOOLS[0];
    const godot: GodotToolName = GODOT_TOOLS[0];
    expect(typeof builtin).toBe("string");
    expect(typeof godot).toBe("string");
  });
});

describe("deriveToolList pure-function contract", () => {
  it("single source: returns as-is", () => {
    const out = deriveToolList(["a", "b"] as const);
    expect([...out]).toEqual(["a", "b"]);
  });

  it("multi-source: concatenates in order, preserves all elements", () => {
    const out = deriveToolList(
      ["a", "b"] as const,
      ["c"] as const,
      ["d", "e"] as const,
    );
    expect([...out]).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("duplicate entries: throws at module load (load-time dedup)", () => {
    expect(() => deriveToolList(["a", "b"] as const, ["b", "c"] as const)).toThrow(
      /duplicate tool name/,
    );
  });

  it("empty inner source: returns the non-empty entries", () => {
    const out = deriveToolList(["x"] as const, [] as unknown as readonly ["x"]);
    expect([...out]).toEqual(["x"]);
  });
});
