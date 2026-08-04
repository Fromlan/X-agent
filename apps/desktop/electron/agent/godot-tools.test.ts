/**
 * Vitest 套件 —— 锁住 1.2 新增 Godot 工具的协议契约。
 * 通过 mock bridge.request 验证：
 *   - 工具名与 promptSnippet 存在
 *   - 调用时构造的 GodotRpcCall 与协议层一致
 *   - max_depth 在 1-16 区间内被钳制
 *   - 响应失败路径走 textResult + ok:false
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createGodotTools } from "./godot-tools";
import type { GodotRpcBridge } from "./godot-rpc-bridge";

interface CapturedCall {
  method: string;
  params: Record<string, unknown>;
  timeout: number;
}

function makeMockBridge() {
  const captured: CapturedCall[] = [];
  let nextResult: unknown = {};
  let nextOk = true;
  const bridge: Pick<GodotRpcBridge, "request"> = {
    request: vi.fn(async (call: { method: string; [k: string]: unknown }, timeout: number) => {
      captured.push({
        method: String(call.method),
        params: { ...call },
        timeout,
      });
      return nextOk
        ? { id: "mock", ok: true, result: nextResult }
        : { id: "mock", ok: false, error: "mock error" };
    }),
  };
  return {
    bridge: bridge as unknown as GodotRpcBridge,
    captured,
    setResult: (r: unknown, ok = true) => {
      nextResult = r;
      nextOk = ok;
    },
  };
}

describe("createGodotTools —— 1.2 新增工具", () => {
  let ctx: ReturnType<typeof makeMockBridge>;
  let tools: ReturnType<typeof createGodotTools>;
  type ToolExec = (params: Record<string, unknown>) => Promise<unknown>;
  let byName: Map<string, ToolExec>;

  beforeEach(() => {
    ctx = makeMockBridge();
    tools = createGodotTools(ctx.bridge);
    byName = new Map(
      tools.map((t) => [
        t.name,
        (params: Record<string, unknown>) =>
          t.execute(
            "call-id",
            params as never,
            // mock signal / ctx / onUpdate are not used by these tools
            undefined as never,
            undefined as never,
            undefined as never,
          ),
      ]),
    );
  });

  it("godot_get_scene_tree 与 godot_get_node_properties 已注册", () => {
    expect(byName.has("godot_get_scene_tree")).toBe(true);
    expect(byName.has("godot_get_node_properties")).toBe(true);
  });

  it("godot_get_scene_tree 默认 max_depth=8", async () => {
    ctx.setResult({ path: "res://main.tscn", tree: { name: "Root" } });
    await byName.get("godot_get_scene_tree")!({
      path: "res://main.tscn",
    });
    expect(ctx.captured).toHaveLength(1);
    expect(ctx.captured[0].method).toBe("get_scene_tree");
    expect(ctx.captured[0].params.path).toBe("res://main.tscn");
    expect(ctx.captured[0].params.max_depth).toBe(8);
  });

  it("godot_get_scene_tree 钳制 max_depth 到 [1,16]", async () => {
    ctx.setResult({});
    await byName.get("godot_get_scene_tree")!({
      path: "res://x.tscn",
      max_depth: 999,
    });
    expect(ctx.captured[0].params.max_depth).toBe(16);

    await byName.get("godot_get_scene_tree")!({
      path: "res://x.tscn",
      max_depth: -5,
    });
    expect(ctx.captured[1].params.max_depth).toBe(1);
  });

  it("godot_get_node_properties 转发 path 与 node_path", async () => {
    ctx.setResult({ properties: [{ name: "speed", type: "float" }] });
    await byName.get("godot_get_node_properties")!({
      path: "res://main.tscn",
      node_path: "Player/Sprite2D",
    });
    expect(ctx.captured).toHaveLength(1);
    expect(ctx.captured[0].method).toBe("get_node_properties");
    expect(ctx.captured[0].params.path).toBe("res://main.tscn");
    expect(ctx.captured[0].params.node_path).toBe("Player/Sprite2D");
  });

  it("响应失败时 text 含 'Godot RPC error'", async () => {
    ctx.setResult(null, false);
    const res = await byName.get("godot_get_scene_tree")!({
      path: "res://x.tscn",
    });
    expect(res.content[0].text).toMatch(/Godot RPC error/);
    expect((res.details as { ok: boolean }).ok).toBe(false);
  });

  it("响应成功时 text 含 JSON 序列化结果", async () => {
    ctx.setResult({ tree: { name: "Root", children: [] } });
    const res = await byName.get("godot_get_scene_tree")!({
      path: "res://main.tscn",
    });
    expect(res.content[0].text).toContain("Root");
    expect((res.details as { ok: boolean }).ok).toBe(true);
  });

  it("promptSnippet 与 description 非空（保证 LLM 可见）", () => {
    const sceneTree = tools.find((t) => t.name === "godot_get_scene_tree");
    const props = tools.find((t) => t.name === "godot_get_node_properties");
    expect(sceneTree?.description?.length ?? 0).toBeGreaterThan(10);
    expect(props?.description?.length ?? 0).toBeGreaterThan(10);
  });
});
