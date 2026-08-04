/**
 * Vitest 套件 —— 锁住 Godot RPC 协议常量与类型守卫。
 * 覆盖 ROADMAP 1.2（tool 扩展）所需的协议面。
 */
import { describe, it, expect } from "vitest";
import {
  GODOT_RPC_ALLOWED_METHODS,
  GODOT_RPC_DEFAULT_PORT,
  GODOT_RPC_DEFAULT_WAIT_MS,
  GODOT_RPC_MAX_WAIT_MS,
  GODOT_RPC_BASE_TIMEOUT_MS,
  GODOT_RPC_GRACE_PERIOD_MS,
  clampGodotRunWaitMs,
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

  it("方法白名单包含所有当前方法 + 新增只读方法", () => {
    // 含 ping + 10 个旧方法 + 1.2 新增的 2 个
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("ping");
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("get_editor_info");
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("stop_scene");
    // 1.2 新增
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("get_scene_tree");
    expect(GODOT_RPC_ALLOWED_METHODS).toContain("get_node_properties");
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
});

describe("isAllowedGodotRpcMethod", () => {
  it("合法方法返回 true", () => {
    expect(isAllowedGodotRpcMethod("ping")).toBe(true);
    expect(isAllowedGodotRpcMethod("get_scene_tree")).toBe(true);
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
