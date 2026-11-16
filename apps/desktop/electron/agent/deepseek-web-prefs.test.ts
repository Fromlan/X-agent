/** Verify old preference migration and atomic round-tripping of an explicit web credential selection. */
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrefs, patchPrefs, setAgentDirOverrideForTests } from "./prefs";
import { DEFAULT_PREFS } from "../../shared/ipc";

let directory: string | undefined;
afterEach(() => {
  setAgentDirOverrideForTests(null);
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

it.each([undefined, null, 42, "", "  "])("migrates an absent or invalid web profile id to null: %s", (id) => {
  directory = mkdtempSync(join(tmpdir(), "x-agent-web-prefs-"));
  setAgentDirOverrideForTests(directory);
  writeFileSync(join(directory, "x-agent.json"), JSON.stringify({ deepseekWebProviderId: id }));
  const prefs = loadPrefs();
  expect(prefs.deepseekWebProviderId).toBeNull();
  expect(prefs.tools).not.toContain("web_search");
  expect(prefs.tools).not.toContain("web_fetch");
  expect(prefs.deepseekLatestReminder).toBe(false);
  expect(prefs.deepseekSafetyCheck).toBe(false);
});

it("keeps reminder and safety checking disabled in fresh and shared defaults", () => {
  directory = mkdtempSync(join(tmpdir(), "x-agent-web-prefs-"));
  setAgentDirOverrideForTests(directory);
  expect(DEFAULT_PREFS).toMatchObject({ deepseekLatestReminder: false, deepseekSafetyCheck: false });
  expect(loadPrefs()).toMatchObject({ deepseekLatestReminder: false, deepseekSafetyCheck: false });
});

it.each([null, "true", 1, {}, []])("does not opt in when persisted reminder or safety values are invalid: %j", (value) => {
  directory = mkdtempSync(join(tmpdir(), "x-agent-web-prefs-"));
  setAgentDirOverrideForTests(directory);
  writeFileSync(join(directory, "x-agent.json"), JSON.stringify({ deepseekLatestReminder: value, deepseekSafetyCheck: value }));
  expect(loadPrefs()).toMatchObject({ deepseekLatestReminder: false, deepseekSafetyCheck: false });
});

it("persists and restores each explicit opt-in independently and accepts an explicit disable", async () => {
  directory = mkdtempSync(join(tmpdir(), "x-agent-web-prefs-"));
  setAgentDirOverrideForTests(directory);
  loadPrefs();
  await patchPrefs({ deepseekLatestReminder: true });
  expect(loadPrefs()).toMatchObject({ deepseekLatestReminder: true, deepseekSafetyCheck: false });
  expect(JSON.parse(readFileSync(join(directory, "x-agent.json"), "utf8"))).toMatchObject({ deepseekLatestReminder: true, deepseekSafetyCheck: false });
  await patchPrefs({ deepseekSafetyCheck: true });
  expect(loadPrefs()).toMatchObject({ deepseekLatestReminder: true, deepseekSafetyCheck: true });
  await patchPrefs({ deepseekLatestReminder: false });
  expect(loadPrefs()).toMatchObject({ deepseekLatestReminder: false, deepseekSafetyCheck: true });
  await patchPrefs({ deepseekSafetyCheck: false });
  expect(loadPrefs()).toMatchObject({ deepseekLatestReminder: false, deepseekSafetyCheck: false });
  expect(JSON.parse(readFileSync(join(directory, "x-agent.json"), "utf8"))).toMatchObject({ deepseekLatestReminder: false, deepseekSafetyCheck: false });
});

it("persists the selected profile and enabled tools, and clears selection explicitly", async () => {
  directory = mkdtempSync(join(tmpdir(), "x-agent-web-prefs-"));
  setAgentDirOverrideForTests(directory);
  loadPrefs();
  await patchPrefs({ deepseekWebProviderId: "official", tools: ["read", "web_search"] });
  expect(loadPrefs()).toMatchObject({ deepseekWebProviderId: "official", tools: ["read", "web_search"] });
  expect(JSON.parse(readFileSync(join(directory, "x-agent.json"), "utf8"))).toMatchObject({ deepseekWebProviderId: "official" });
  await patchPrefs({ deepseekWebProviderId: null });
  expect(loadPrefs().deepseekWebProviderId).toBeNull();
});
