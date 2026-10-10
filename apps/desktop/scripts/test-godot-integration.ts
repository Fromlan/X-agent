/** Validate the actual editor addon and authenticated RPC against a disposable Godot 4 project. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setAgentDirOverrideForTests } from "../electron/agent/prefs";
import { setGodotRpcEndpointPathForTests, GodotRpcBridge } from "../electron/agent/godot-rpc-bridge";
import { installGodotRpcAddon } from "../electron/agent/godot-addon-install";

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
try {
  writeFileSync(join(project, "project.godot"), 'config_version=5\n[application]\nconfig/name="RPC integration fixture"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
  writeFileSync(join(project, "main.gd"), 'extends Node\nfunc verified() -> int:\n\treturn 42\n');
  writeFileSync(join(project, "main.tscn"), '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n');
  assert.equal(installGodotRpcAddon(project).ok, true);
  bridge.setCurrentCwd(project);
  const started = await bridge.start(0);
  assert.equal(started.running, true); assert.ok(started.port > 0, "endpoint must advertise the assigned port");
  editor = spawn(binary, ["--headless", "--editor", "--path", project], {
    windowsHide: true, env: { ...process.env, USERPROFILE: root, HOME: root }, stdio: ["ignore", "pipe", "pipe"],
  });
  // `exit` precedes stream/handle closure on Windows; cleanup must wait for `close` instead.
  editorClosed = new Promise<void>((resolve) => editor!.once("close", () => resolve()));
  editor.on("error", (error) => { log += error.message; });
  const collect = (data: Buffer) => { log = (log + data.toString()).slice(-20_000); };
  editor.stdout?.on("data", collect); editor.stderr?.on("data", collect);
  await waitFor(editor, () => (bridge.getStatus().authenticatedClients ?? 0) > 0);
  console.log(`Godot ${version}: authenticated addon loaded`);
  const info = await bridge.request({ id: "info", method: "get_editor_info" }); assert.equal(info.ok, true);
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
  console.log("Godot integration passed: editor info, scene open/readback, valid and invalid script lint with line evidence");
} catch (error) {
  console.error("Godot integration failed", error, log);
  process.exitCode = 1;
} finally {
  if (editor && editor.exitCode === null) {
    editor.kill();
  }
  if (editorClosed) await Promise.race([editorClosed, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
  await bridge.stop(); setGodotRpcEndpointPathForTests(null); setAgentDirOverrideForTests(null);
  // Bounded retries handle transient Windows directory locks after verified child shutdown, not failed business assertions.
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
