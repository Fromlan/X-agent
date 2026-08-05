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

describe("createGodotTools —— 1.2 剩余 7 个工具", () => {
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
            undefined as never,
            undefined as never,
            undefined as never,
          ),
      ]),
    );
  });

  it("7 个新工具全部注册", () => {
    for (const n of [
      "godot_get_project_setting",
      "godot_set_project_setting",
      "godot_lint_scripts",
      "godot_find_unused_resources",
      "godot_export_project",
      "godot_get_debugger_state",
      "godot_set_breakpoint",
    ]) {
      expect(byName.has(n)).toBe(true);
    }
  });

  it("godot_get_project_setting 转发 key", async () => {
    ctx.setResult({ exists: true, key: "application/config/name", value: "Game" });
    await byName.get("godot_get_project_setting")!({
      key: "application/config/name",
    });
    expect(ctx.captured[0].method).toBe("get_project_setting");
    expect(ctx.captured[0].params.key).toBe("application/config/name");
  });

  it("godot_set_project_setting 转发 key 与 value", async () => {
    ctx.setResult({ saved: true, key: "x" });
    await byName.get("godot_set_project_setting")!({
      key: "display/window/size/viewport_width",
      value: 1280,
    });
    expect(ctx.captured[0].method).toBe("set_project_setting");
    expect(ctx.captured[0].params.key).toBe("display/window/size/viewport_width");
    expect(ctx.captured[0].params.value).toBe(1280);
  });

  it("godot_lint_scripts 转发 paths 并格式化失败详情", async () => {
    ctx.setResult({
      files: [
        { path: "res://ok.gd", ok: true, issues: [] },
        {
          path: "res://bad.gd",
          ok: false,
          issues: [
            { line: 4, column: 0, message: "Parse Error: x", severity: "error" },
          ],
        },
      ],
    });
    const res = await byName.get("godot_lint_scripts")!({
      paths: ["res://ok.gd", "res://bad.gd"],
    });
    expect(ctx.captured[0].method).toBe("lint_scripts");
    expect(ctx.captured[0].params.paths).toEqual([
      "res://ok.gd",
      "res://bad.gd",
    ]);
    const text = String(res.content[0].text);
    expect(text).toContain("OK  res://ok.gd");
    expect(text).toContain("res://bad.gd:4");
    expect((res.details as { hasError: boolean }).hasError).toBe(true);
  });

  it("godot_lint_scripts 全部通过时 hasError=false", async () => {
    ctx.setResult({ files: [{ path: "res://ok.gd", ok: true, issues: [] }] });
    const res = await byName.get("godot_lint_scripts")!({ paths: ["res://ok.gd"] });
    expect((res.details as { hasError: boolean }).hasError).toBe(false);
  });

  it("godot_find_unused_resources 默认 root=res://，可指定子目录", async () => {
    ctx.setResult({ unused: [{ path: "res://o.tscn", kind: "scene" }] });
    await byName.get("godot_find_unused_resources")!({});
    expect(ctx.captured[0].method).toBe("find_unused_resources");
    expect(ctx.captured[0].params.root).toBe("res://");
    await byName.get("godot_find_unused_resources")!({ root: "res://scenes" });
    expect(ctx.captured[1].params.root).toBe("res://scenes");
  });

  it("godot_export_project 转发 preset/output_dir/debug", async () => {
    ctx.setResult({
      ok: true,
      timedOut: false,
      outputPath: "D:/out/game.exe",
      errors: [],
    });
    const res = await byName.get("godot_export_project")!({
      preset: "Windows Desktop",
      output_dir: "D:/out/game.exe",
      debug: true,
    });
    expect(ctx.captured[0].method).toBe("export_project");
    expect(ctx.captured[0].params.preset).toBe("Windows Desktop");
    expect(ctx.captured[0].params.output_dir).toBe("D:/out/game.exe");
    expect(ctx.captured[0].params.debug).toBe(true);
    expect(String(res.content[0].text)).toContain("Export succeeded");
    expect((res.details as { hasError: boolean }).hasError).toBe(false);
  });

  it("godot_export_project 失败时文本含错误摘要且 hasError=true", async () => {
    ctx.setResult({
      ok: false,
      timedOut: false,
      outputPath: "D:/out/game.exe",
      errors: ["ERROR: missing template"],
    });
    const res = await byName.get("godot_export_project")!({
      preset: "Windows Desktop",
      output_dir: "D:/out/game.exe",
    });
    const text = String(res.content[0].text);
    expect(text).toContain("Export failed");
    expect(text).toContain("missing template");
    expect((res.details as { hasError: boolean }).hasError).toBe(true);
  });

  it("godot_get_debugger_state 无参调用", async () => {
    ctx.setResult({ playing: false, sessions: [], breakCount: 0 });
    await byName.get("godot_get_debugger_state")!({});
    expect(ctx.captured[0].method).toBe("get_debugger_state");
    expect(ctx.captured[0].params.method).toBe("get_debugger_state");
  });

  it("godot_set_breakpoint 转发 file/line/remove 并钳制 line>=1", async () => {
    ctx.setResult({ ok: true, appliedSessions: 0 });
    await byName.get("godot_set_breakpoint")!({
      file: "res://player.gd",
      line: 12,
      remove: true,
    });
    expect(ctx.captured[0].method).toBe("set_breakpoint");
    expect(ctx.captured[0].params.file).toBe("res://player.gd");
    expect(ctx.captured[0].params.line).toBe(12);
    expect(ctx.captured[0].params.remove).toBe(true);
    await byName.get("godot_set_breakpoint")!({
      file: "res://player.gd",
      line: 0,
    });
    expect(ctx.captured[1].params.line).toBe(1);
    expect(ctx.captured[1].params.remove).toBe(false);
  });
});
