/** Verify migration, concurrent project engine choices and preservation of explicit user selections. */
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCachedPrefs, loadPrefs, rememberGodotEditor, setAgentDirOverrideForTests } from "./prefs";

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
