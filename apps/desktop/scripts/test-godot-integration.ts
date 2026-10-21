/** Validate the actual editor addon and authenticated RPC against a disposable Godot 4 project. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setAgentDirOverrideForTests } from "../electron/agent/prefs";
import { setGodotRpcEndpointPathForTests, GodotRpcBridge } from "../electron/agent/godot-rpc-bridge";
import { installGodotRpcAddon } from "../electron/agent/godot-addon-install";
import { inspectGodotRpcAddon } from "../electron/agent/godot-addon-install";
import { GodotConnectionManager } from "../electron/agent/godot-connection-manager";
import { discoverGodotEngine } from "../electron/agent/godot-engine-discovery";
import { DEFAULT_PREFS } from "../shared/ipc";
import { createGodotTools } from "../electron/agent/godot-tools";
import { requestGuardedGodotRpc } from "../electron/agent/godot-rpc-request";

/** Poll a specific running editor with a bounded deadline and fail immediately on process exit. */
async function waitFor(editor: ChildProcess, condition: () => boolean, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (editor.exitCode !== null || editor.signalCode !== null) throw new Error("Godot editor exited before verification");
    if (Date.now() >= deadline) throw new Error("Godot editor/RPC readiness timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const binary = process.env.GODOT_BIN;
if (!binary) throw new Error("GODOT_BIN is required; this integration test cannot pass or silently skip without a real Godot editor");
const version = execFileSync(binary, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
assert.match(version, /^4\./, "Godot 4 is required");
const root = mkdtempSync(join(tmpdir(), "x-agent-godot-integration-"));
const project = join(root, "project"); const agentDir = join(root, ".pi", "agent");
mkdirSync(project); mkdirSync(agentDir, { recursive: true });
setAgentDirOverrideForTests(agentDir);
setGodotRpcEndpointPathForTests(join(agentDir, "x-agent-godot-rpc.json"));
const bridge = new GodotRpcBridge(); let editor: ChildProcess | undefined; let editorClosed: Promise<void> | undefined; let log = "";
let connection: GodotConnectionManager | undefined;
try {
  writeFileSync(join(project, "project.godot"), 'config_version=5\n[application]\nconfig/name="RPC integration fixture"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
  writeFileSync(join(project, "main.gd"), 'extends Node\nfunc verified() -> int:\n\treturn 42\n');
  writeFileSync(join(project, "main.tscn"), '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n');
  const started = await bridge.start(0);
  assert.equal(started.running, true); assert.ok(started.port > 0, "endpoint must advertise the assigned port");
  const prefs = { ...DEFAULT_PREFS, godotEditorPath: binary };
  let launches = 0;
  connection = new GodotConnectionManager(bridge, {
    prefs: () => prefs, isProject: () => true,
    inspect: inspectGodotRpcAddon, install: installGodotRpcAddon,
    running: async () => [],
    discover: (path, config, running, signal) => discoverGodotEngine(path, config, running, { candidates: [], signal }),
    launch: async (engine, path) => {
      launches += 1;
      editor = spawn(engine, ["--headless", "--editor", "--path", path], {
        windowsHide: true, env: { ...process.env, USERPROFILE: root, HOME: root }, stdio: ["ignore", "pipe", "pipe"],
      });
      // `exit` precedes stream/handle closure on Windows; cleanup must wait for `close` instead.
      editorClosed = new Promise<void>((resolve) => editor!.once("close", () => resolve()));
      editor.on("error", (error) => { log += error.message; });
      const collect = (data: Buffer): void => { log = (log + data.toString()).slice(-20_000); };
      editor.stdout?.on("data", collect); editor.stderr?.on("data", collect);
      await new Promise<void>((resolve, reject) => { editor!.once("spawn", resolve); editor!.once("error", reject); });
      return editor.pid!;
    },
    isAlive: () => Boolean(editor && editor.exitCode === null && editor.signalCode === null),
    remember: async () => {},
  });
  bridge.setCurrentCwd(project);
  const connected = await connection.connect();
  assert.equal(connected.ok, true, connected.error);
  assert.equal(connection.getStatus().connection?.phase, "connected");
  assert.equal(inspectGodotRpcAddon(project).current, true);
  assert.equal(launches, 1);
  assert.ok(editor, "the manager must launch the real editor");
  console.log(`Godot ${version}: project open automatically installed the addon, launched once, authenticated and passed health check`);
  const info = await bridge.request({ id: "info", method: "get_editor_info" }); assert.equal(info.ok, true);
  // Exercise the real tool -> shared guard -> authenticated bridge -> editor -> project.godot chain.
  const setSetting = createGodotTools(bridge).find((tool) => tool.name === "godot_set_project_setting");
  assert.ok(setSetting);
  const legalSetting = await setSetting.execute("legal-setting", { key: "display/window/size/viewport_width", value: 1234 } as never, undefined as never, undefined as never, undefined as never);
  assert.equal((legalSetting.details as { ok: boolean }).ok, true);
  const readSetting = await bridge.request({ id: "read-setting", method: "get_project_setting", key: "display/window/size/viewport_width" });
  assert.equal(readSetting.ok, true);
  assert.equal((readSetting.result as { value: unknown }).value, 1234);
  assert.match(readFileSync(join(project, "project.godot"), "utf8"), /size\/viewport_width=1234/);
  for (const key of ["application/config/project_settings_override", "application/config/project_settings_override.windows", "application/config/disable_project_settings_override"]) {
    const before = await bridge.request({ id: `before-${key}`, method: "get_project_setting", key });
    assert.equal(before.ok, true);
    const bytes = readFileSync(join(project, "project.godot"));
    const blockedTool = await setSetting.execute("unsafe-setting", { key, value: "res://evil.cfg" } as never, undefined as never, undefined as never, undefined as never);
    assert.equal((blockedTool.details as { ok: boolean }).ok, false);
    const blockedSharedIngress = await requestGuardedGodotRpc(bridge, { method: "set_project_setting", key, value: "res://evil.cfg" });
    assert.equal(blockedSharedIngress.ok, false);
    const after = await bridge.request({ id: `after-${key}`, method: "get_project_setting", key });
    assert.equal(after.ok, true);
    assert.deepEqual(after.result, before.result, `${key} editor value must remain unchanged`);
    assert.deepEqual(readFileSync(join(project, "project.godot")), bytes, `${key} must not alter project.godot`);
  }
  const invalidValue = await requestGuardedGodotRpc(bridge, { method: "set_project_setting", key: "display/window/size/viewport_width", value: null });
  assert.equal(invalidValue.ok, false);
  const retainedSetting = await bridge.request({ id: "retained-setting", method: "get_project_setting", key: "display/window/size/viewport_width" });
  assert.equal(retainedSetting.ok, true);
  assert.equal((retainedSetting.result as { value: unknown }).value, 1234);
  console.log("Godot ProjectSettings passed: real tool write/readback, shared boundary rejects actual override keys and preserves editor values/file bytes");
  const open = await bridge.request({ id: "open", method: "open_scene", path: "res://main.tscn" }); assert.equal(open.ok, true);
  await waitFor(editor, () => log.includes("RPC"), 10_000);
  const scene = await bridge.request({ id: "scene", method: "get_edited_scene" }); assert.equal(scene.ok, true);
  assert.match(JSON.stringify(scene), /main\.tscn|Main/);
  const valid = await bridge.request({ id: "lint-good", method: "lint_scripts", paths: ["res://main.gd"] }, 30_000); assert.equal(valid.ok, true);
  assert.match(JSON.stringify(valid), /"ok":true/);
  writeFileSync(join(project, "broken.gd"), 'extends Node\nfunc bad(:\n');
  const invalid = await bridge.request({ id: "lint-bad", method: "lint_scripts", paths: ["res://broken.gd"] }, 30_000); assert.equal(invalid.ok, true);
  assert.match(JSON.stringify(invalid), /"ok":false/);
  assert.match(JSON.stringify(invalid), /"line":[1-9]/);
  await connection.stop();
  const reconnected = await connection.connect();
  assert.equal(reconnected.ok, true, reconnected.error);
  assert.equal(launches, 1, "bridge restart must reuse the existing editor");
  assert.equal((await bridge.request({ id: "after-restart", method: "get_editor_info" })).ok, true);
  assert.ok(bridge.getCurrentCwd(), "bridge restart must retain project isolation");
  console.log("Godot connection restart passed: same editor, healthy RPC and preserved project routing");
  console.log("Godot integration passed: editor info, scene open/readback, valid and invalid script lint with line evidence");
} catch (error) {
  console.error("Godot integration failed", error, log);
  process.exitCode = 1;
} finally {
  connection?.dispose();
  if (editor && editor.exitCode === null) {
    editor.kill();
  }
  if (editorClosed) await Promise.race([editorClosed, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
  await bridge.stop(); setGodotRpcEndpointPathForTests(null); setAgentDirOverrideForTests(null);
  // Bounded retries handle transient Windows directory locks after verified child shutdown, not failed business assertions.
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
