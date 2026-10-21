/** Verify migration, concurrent project engine choices and preservation of explicit user selections. */
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCachedPrefs, loadPrefs, rememberGodotEditor, registerGodotEngine, updateGodotEngine, setAgentDirOverrideForTests } from "./prefs";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "xagent-godot-prefs-")); setAgentDirOverrideForTests(root); });
afterEach(() => { setAgentDirOverrideForTests(null); rmSync(root, { recursive: true, force: true }); });

it("migrates existing preferences without overwriting opt-out or accepting malformed engine maps", () => {
  writeFileSync(join(root, "x-agent.json"), JSON.stringify({ godotAutoConnect: false, godotProjectEditors: ["invalid"] }));
  expect(loadPrefs()).toMatchObject({ godotAutoConnect: false, godotProjectEditors: {} });
  writeFileSync(join(root, "x-agent.json"), "{}");
  expect(loadPrefs().godotAutoConnect).toBe(true);
});

it("merges concurrent engine discoveries inside the preference store lock", async () => {
  loadPrefs();
  await Promise.all([rememberGodotEditor("D:/First", "C:/first.exe"), rememberGodotEditor("D:/Second", "C:/second.exe")]);
  expect(getCachedPrefs().godotProjectEditors).toEqual({ "d:/first": "C:/first.exe", "d:/second": "C:/second.exe" });
});

it("a late automatic discovery cannot overwrite an explicit project engine", async () => {
  loadPrefs();
  await rememberGodotEditor("D:/game", "C:/selected.exe", { setDefault: true });
  await rememberGodotEditor("D:/game", "C:/running.exe", { onlyIfUnset: true });
  expect(getCachedPrefs()).toMatchObject({ godotEditorPath: "C:/selected.exe", godotProjectEditors: { "d:/game": "C:/selected.exe" } });
});

it("migrates legacy default and project engines with Windows path deduplication", () => {
  writeFileSync(join(root, "x-agent.json"), JSON.stringify({ godotEditorPath: "C:/Godot.exe", godotProjectEditors: { "D:\\Game": "c:\\godot.exe", "D:/Other": "C:/other.exe" } }));
  const prefs = loadPrefs();
  expect(prefs.godotEngines).toHaveLength(2);
  expect(prefs.godotEngines.every((engine) => engine.version === "")).toBe(true);
  expect(prefs.godotProjectEditors["d:/game"]).toBe("c:\\godot.exe");
});

it("keeps multiple versions and preserves custom names when the same executable is registered again", async () => {
  loadPrefs();
  await Promise.all([
    registerGodotEngine({ path: "C:/Godot46.exe", name: "Legacy", version: "4.6.2.stable" }),
    registerGodotEngine({ path: "C:/Godot47.exe", name: "Latest", version: "4.7.2.stable" }),
  ]);
  await updateGodotEngine({ action: "rename", path: "c:\\godot47.exe", name: "  Production  " });
  await registerGodotEngine({ path: "C:/GODOT47.exe", name: "Godot", version: "4.7.2.stable.official" });
  expect(loadPrefs().godotEngines).toEqual([
    { path: "C:/Godot46.exe", name: "Legacy", version: "4.6.2.stable" },
    { path: "C:/GODOT47.exe", name: "Production", version: "4.7.2.stable.official" },
  ]);
});

it("persists independent project selections without overwriting the global default", async () => {
  loadPrefs();
  for (const path of ["C:/a.exe", "C:/b.exe"]) await registerGodotEngine({ path, name: path, version: "4.7.2.stable" });
  await updateGodotEngine({ action: "default", path: "C:/a.exe" });
  await Promise.all([
    updateGodotEngine({ action: "project", projectPath: "D:/First", path: "C:/a.exe" }),
    updateGodotEngine({ action: "project", projectPath: "D:/Second", path: "C:/b.exe" }),
  ]);
  expect(loadPrefs()).toMatchObject({ godotEditorPath: "C:/a.exe", godotProjectEditors: { "d:/first": "C:/a.exe", "d:/second": "C:/b.exe" } });
  await updateGodotEngine({ action: "project", projectPath: "D:/First", path: null });
  expect(loadPrefs().godotProjectEditors).toEqual({ "d:/second": "C:/b.exe" });
});

it("removes an engine and every reference atomically while preserving other versions", async () => {
  loadPrefs();
  for (const path of ["C:/a.exe", "C:/b.exe"]) await registerGodotEngine({ path, name: path, version: "4.7.2.stable" });
  await updateGodotEngine({ action: "default", path: "C:/a.exe" });
  await rememberGodotEditor("D:/First", "c:\\A.exe");
  await rememberGodotEditor("D:/Second", "C:/b.exe");
  await updateGodotEngine({ action: "remove", path: "C:/a.exe" });
  const prefs = loadPrefs();
  expect(prefs.godotEditorPath).toBeNull();
  expect(prefs.godotProjectEditors).toEqual({ "d:/second": "C:/b.exe" });
  expect(prefs.godotEngines.map((engine) => engine.path)).toEqual(["C:/b.exe"]);
  await expect(updateGodotEngine({ action: "default", path: "C:/a.exe" })).rejects.toThrow("已移除");
});

it("ignores malformed registry entries without losing valid installations", () => {
  writeFileSync(join(root, "x-agent.json"), JSON.stringify({ godotEngines: [
    null, { path: "C:/bad.exe", name: "", version: "4.7.2" },
    { path: "C:/valid.exe", name: "Valid", version: "4.7.2.stable" },
  ] }));
  expect(loadPrefs().godotEngines).toEqual([{ path: "C:/valid.exe", name: "Valid", version: "4.7.2.stable" }]);
});

it("cannot resurrect a removed installation from a cancelled automatic discovery", async () => {
  loadPrefs();
  const engine = { path: "C:/a.exe", name: "Godot", version: "4.7.2.stable" };
  await registerGodotEngine(engine);
  await updateGodotEngine({ action: "remove", path: engine.path });
  const controller = new AbortController();
  controller.abort();
  await expect(registerGodotEngine(engine, controller.signal)).rejects.toThrow();
  expect(loadPrefs().godotEngines).toEqual([]);
});
