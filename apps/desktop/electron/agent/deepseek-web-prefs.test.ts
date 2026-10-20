/** Verify old preference migration and atomic round-tripping of an explicit web credential selection. */
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrefs, patchPrefs, setAgentDirOverrideForTests } from "./prefs";

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
