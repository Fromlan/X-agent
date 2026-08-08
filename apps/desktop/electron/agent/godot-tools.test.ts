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

describe("createGodotTools —— 1.3 只读内省 / UID / 类名 / 脚本反射 / 导出预检", () => {
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

  const NAMES = [
    "godot_list_project_files",
    "godot_resolve_uid",
    "godot_wait_for_import_done",
    "godot_list_global_classes",
    "godot_find_class_name_conflicts",
    "godot_inspect_script",
    "godot_list_export_presets",
    "godot_check_export_templates",
  ];

  it("全部 8 个工具已注册", () => {
    for (const n of NAMES) expect(byName.has(n)).toBe(true);
  });

  it("description + promptSnippet 非空（保证 LLM 可见）", () => {
    for (const n of NAMES) {
      const t = tools.find((x) => x.name === n);
      expect(t?.description?.length ?? 0).toBeGreaterThan(10);
      expect(t?.promptSnippet?.length ?? 0).toBeGreaterThan(5);
    }
  });

  it("godot_list_project_files 转发 root/type/pattern/limit/cursor，钳制 limit 1-5000", async () => {
    ctx.setResult({ total: 0, files: [] });
    await byName.get("godot_list_project_files")!({
      root: "res://scenes",
      type: "scene",
      pattern: "main",
      limit: 100,
      cursor: "res://scenes/a",
    });
    expect(ctx.captured[0].method).toBe("list_project_files");
    expect(ctx.captured[0].params.root).toBe("res://scenes");
    expect(ctx.captured[0].params.type).toBe("scene");
    expect(ctx.captured[0].params.pattern).toBe("main");
    expect(ctx.captured[0].params.limit).toBe(100);
    expect(ctx.captured[0].params.cursor).toBe("res://scenes/a");

    await byName.get("godot_list_project_files")!({ limit: 9999 });
    expect(ctx.captured[1].params.limit).toBe(5000);

    await byName.get("godot_list_project_files")!({ limit: 0 });
    expect(ctx.captured[2].params.limit).toBe(500);
  });

  it("godot_list_project_files 文本含 root / total / 文件行", async () => {
    ctx.setResult({
      root: "res://",
      total: 12,
      files: [
        { path: "res://main.tscn", type: "scene" },
        { path: "res://player.gd", type: "script" },
      ],
    });
    const res = await byName.get("godot_list_project_files")!({});
    const text = String(res.content[0].text);
    expect(text).toContain("res://main.tscn");
    expect(text).toContain("res://player.gd");
    expect(text).toContain("total=");
  });

  it("godot_resolve_uid 在只给 uid 时转发 uid", async () => {
    ctx.setResult({
      uid: "uid://abc",
      path: "res://foo.gd",
      exists: true,
    });
    await byName.get("godot_resolve_uid")!({ uid: "uid://abc" });
    expect(ctx.captured[0].method).toBe("resolve_uid");
    expect(ctx.captured[0].params.uid).toBe("uid://abc");
    expect(ctx.captured[0].params.path).toBe("");
  });

  it("godot_resolve_uid 在只给 path 时转发 path", async () => {
    ctx.setResult({
      uid: "uid://xyz",
      path: "res://bar.gd",
      exists: true,
    });
    await byName.get("godot_resolve_uid")!({ path: "res://bar.gd" });
    expect(ctx.captured[0].method).toBe("resolve_uid");
    expect(ctx.captured[0].params.uid).toBe("");
    expect(ctx.captured[0].params.path).toBe("res://bar.gd");
  });

  it("godot_resolve_uid 两个都给则直接报错不发 RPC", async () => {
    const res = await byName.get("godot_resolve_uid")!({
      uid: "uid://a",
      path: "res://b",
    });
    expect(ctx.captured).toHaveLength(0);
    expect(res.content[0].text).toMatch(/only one|Provide/i);
    expect((res.details as { ok: boolean }).ok).toBe(false);
  });

  it("godot_resolve_uid 都不给则直接报错", async () => {
    const res = await byName.get("godot_resolve_uid")!({});
    expect(ctx.captured).toHaveLength(0);
    expect((res.details as { ok: boolean }).ok).toBe(false);
  });

  it("godot_resolve_uid 成功文本含 exists + uid + path", async () => {
    ctx.setResult({
      uid: "uid://abc",
      path: "res://foo.gd",
      exists: true,
    });
    const res = await byName.get("godot_resolve_uid")!({ uid: "uid://abc" });
    const text = String(res.content[0].text);
    expect(text).toContain("exists=true");
    expect(text).toContain("uid=uid://abc");
    expect(text).toContain("path=res://foo.gd");
  });

  it("godot_wait_for_import_done 转发 paths/timeout_ms 并钳制 0-60000", async () => {
    ctx.setResult({ ok: true, remaining: [], elapsedMs: 100 });
    await byName.get("godot_wait_for_import_done")!({
      paths: ["res://a.png", "res://b.wav"],
      timeout_ms: 5000,
    });
    expect(ctx.captured[0].method).toBe("wait_for_import_done");
    expect(ctx.captured[0].params.paths).toEqual(["res://a.png", "res://b.wav"]);
    expect(ctx.captured[0].params.timeout_ms).toBe(5000);

    await byName.get("godot_wait_for_import_done")!({
      paths: ["res://x.png"],
      timeout_ms: 999999,
    });
    expect(ctx.captured[1].params.timeout_ms).toBe(60000);

    await byName.get("godot_wait_for_import_done")!({
      paths: ["res://y.png"],
    });
    expect(ctx.captured[2].params.timeout_ms).toBe(30000);
  });

  it("godot_wait_for_import_done paths 为空时直接报错", async () => {
    const res = await byName.get("godot_wait_for_import_done")!({ paths: [] });
    expect(ctx.captured).toHaveLength(0);
    expect((res.details as { ok: boolean }).ok).toBe(false);
  });

  it("godot_wait_for_import_done 规范化相对路径并拒绝绝对路径", async () => {
    ctx.setResult({ ok: true, remaining: [], elapsedMs: 10 });
    await byName.get("godot_wait_for_import_done")!({
      paths: ["  textures/hero.png ", "res://a.wav"],
    });
    expect(ctx.captured[0].params.paths).toEqual([
      "res://textures/hero.png",
      "res://a.wav",
    ]);

    const abs = await byName.get("godot_wait_for_import_done")!({
      paths: ["D:/x/hero.png"],
    });
    expect(ctx.captured).toHaveLength(1);
    expect((abs.details as { ok: boolean }).ok).toBe(false);

    const slash = await byName.get("godot_wait_for_import_done")!({
      paths: ["/tmp/hero.png"],
    });
    expect(ctx.captured).toHaveLength(1);
    expect((slash.details as { ok: boolean }).ok).toBe(false);
  });

  it("godot_wait_for_import_done 成功 / remaining 非空文本与 hasError", async () => {
    ctx.setResult({
      ok: true,
      remaining: [],
      elapsedMs: 250,
    });
    const ok = await byName.get("godot_wait_for_import_done")!({
      paths: ["res://a.png"],
    });
    expect(String(ok.content[0].text)).toContain("Import complete");
    expect((ok.details as { hasError: boolean }).hasError).toBe(false);

    ctx.setResult({
      ok: false,
      remaining: ["res://c.png"],
      elapsedMs: 60000,
    });
    const left = await byName.get("godot_wait_for_import_done")!({
      paths: ["res://c.png"],
    });
    expect(String(left.content[0].text)).toContain("res://c.png");
    expect((left.details as { hasError: boolean }).hasError).toBe(true);
  });

  it("godot_list_global_classes 无参", async () => {
    ctx.setResult({ classes: [], count: 0 });
    await byName.get("godot_list_global_classes")!({});
    expect(ctx.captured[0].method).toBe("list_global_classes");
  });

  it("godot_find_class_name_conflicts 转发 include_addons", async () => {
    ctx.setResult({ conflicts: [], count: 0 });
    await byName.get("godot_find_class_name_conflicts")!({
      include_addons: true,
    });
    expect(ctx.captured[0].method).toBe("find_class_name_conflicts");
    expect(ctx.captured[0].params.include_addons).toBe(true);

    await byName.get("godot_find_class_name_conflicts")!({});
    expect(ctx.captured[1].params.include_addons).toBe(false);
  });

  it("godot_inspect_script 转发 path 并在 path 为空时报错", async () => {
    ctx.setResult({
      path: "res://player.gd",
      signals: [],
      methods: [],
      properties: [],
      constants: [],
    });
    await byName.get("godot_inspect_script")!({ path: "res://player.gd" });
    expect(ctx.captured[0].method).toBe("inspect_script");
    expect(ctx.captured[0].params.path).toBe("res://player.gd");

    const res = await byName.get("godot_inspect_script")!({});
    expect(ctx.captured).toHaveLength(1);
    expect((res.details as { ok: boolean }).ok).toBe(false);
  });

  it("godot_inspect_script 文本含 signals/properties/methods 块", async () => {
    ctx.setResult({
      path: "res://player.gd",
      signals: [{ name: "died" }],
      methods: [{ name: "take_damage", type: "void" }],
      properties: [{ name: "hp", type: "int" }],
      constants: [{ name: "MAX_HP", type: "int" }],
    });
    const res = await byName.get("godot_inspect_script")!({
      path: "res://player.gd",
    });
    const text = String(res.content[0].text);
    expect(text).toContain("signals");
    expect(text).toContain("died");
    expect(text).toContain("hp");
    expect(text).toContain("take_damage");
    expect(text).toContain("MAX_HP");
  });

  it("godot_list_export_presets 无参", async () => {
    ctx.setResult({ presets: [], count: 0 });
    await byName.get("godot_list_export_presets")!({});
    expect(ctx.captured[0].method).toBe("list_export_presets");
  });

  it("godot_check_export_templates 无参 + 文本随 installed 变化", async () => {
    ctx.setResult({
      installed: true,
      version: "4.7",
      templateDir: "/x/exported/templates/4.7",
      templateFiles: ["windows_x86_64"],
      missingPlatforms: [],
    });
    const ok = await byName.get("godot_check_export_templates")!({});
    expect(ctx.captured[0].method).toBe("check_export_templates");
    expect(String(ok.content[0].text)).toContain("Templates installed");
    expect((ok.details as { hasError: boolean }).hasError).toBe(false);

    ctx.setResult({
      installed: false,
      version: "4.7",
      templateDir: "/x/exported/templates/4.7",
      templateFiles: [],
      missingPlatforms: [],
    });
    const bad = await byName.get("godot_check_export_templates")!({});
    expect(String(bad.content[0].text)).toContain("NOT installed");
    expect((bad.details as { hasError: boolean }).hasError).toBe(true);
  });

  it("响应失败时 1.3 工具返回含 'Godot RPC error'", async () => {
    ctx.setResult(null, false);
    const res = await byName.get("godot_list_global_classes")!({});
    expect(res.content[0].text).toMatch(/Godot RPC error/);
    expect((res.details as { ok: boolean }).ok).toBe(false);
  });
});
