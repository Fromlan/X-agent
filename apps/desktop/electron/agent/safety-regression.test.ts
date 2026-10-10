/** Exercise real filesystem boundaries and shared configuration corruption without user data. */
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveInsideCwd } from "./cwd-sandbox";
import { isLexicallyInside } from "./lib/path-boundary";
import { readProjectFile } from "./project-fs";
import { shouldBlockReadonlyModeToolCall } from "./session-mode/plan-mode-guard";
import { shouldBlockDesignSessionWrite } from "./session-mode/design-write-guard";
import { isAllowedPluginPath } from "./plugin-host";
import { bashCommandEscapesCwd } from "./session-mode/bash-readonly";
import { withAuthLock, writeAuthFile } from "./provider-pi-sync/pi-auth-port";
import { withModelsLock, writeModelsFile } from "./provider-pi-sync/pi-models-port";
import { mutatePiSettingsSync } from "./pi-settings";
import { pruneProviderIdFromPi } from "./provider-pi-sync";
import { setAgentDirOverrideForTests } from "./prefs";

const roots: string[] = [];
/** Create an isolated fixture directory for each test. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "x-agent-safety-"));
  roots.push(root);
  const project = join(root, "project");
  const outside = join(root, "outside");
  mkdirSync(project); mkdirSync(outside);
  writeFileSync(join(outside, "proof.txt"), "outside");
  return { root, project, outside };
}
afterEach(() => {
  setAgentDirOverrideForTests(null);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("rejects junction reads and writes across project, Ask and design guards", () => {
  const { project, outside } = fixture();
  symlinkSync(outside, join(project, "linked"), "junction");
  mkdirSync(join(project, "game-design"));
  symlinkSync(outside, join(project, "game-design", "linked"), "junction");
  expect(resolveInsideCwd(project, "linked/proof.txt").ok).toBe(false);
  expect(readProjectFile(project, "linked/proof.txt").ok).toBe(false);
  expect(shouldBlockReadonlyModeToolCall("ask", "read", ["read"], { path: "linked/proof.txt" }, project).block).toBe(true);
  expect(bashCommandEscapesCwd("ls linked", project)).toBe(true);
  expect(bashCommandEscapesCwd("cat linked*/proof.txt", project)).toBe(true);
  expect(shouldBlockDesignSessionWrite("design", "write", { path: "game-design/linked/new/deep.md", content: "x" }, project).block).toBe(true);
});

it("rejects design links to code inside cwd, accepts a junction project root and safe new paths", () => {
  const { root, project } = fixture();
  mkdirSync(join(project, "code")); mkdirSync(join(project, "game-design"));
  symlinkSync(join(project, "code"), join(project, "game-design", "linked"), "junction");
  expect(shouldBlockDesignSessionWrite("design", "write", { path: "game-design/linked/new.md" }, project).block).toBe(true);
  const alias = join(root, "alias"); symlinkSync(project, alias, "junction");
  expect(resolveInsideCwd(alias, "game-design/new/deep.md").ok).toBe(true);
  expect(resolveInsideCwd(project, project + "-other/file.md").ok).toBe(false);
});

it("rejects file symlinks and dangling symlinks without treating them as future write targets", (context) => {
  const { project, outside } = fixture();
  try {
    symlinkSync(join(outside, "proof.txt"), join(project, "linked-file.txt"), "file");
    symlinkSync(join(outside, "missing.txt"), join(project, "dangling.txt"), "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") context.skip();
    else throw error;
  }
  expect(resolveInsideCwd(project, "linked-file.txt").ok).toBe(false);
  expect(resolveInsideCwd(project, "dangling.txt").ok).toBe(false);
});

it("compares UNC shares, drive changes and prefix-similar directories by complete segments", () => {
  if (process.platform !== "win32") return;
  expect(isLexicallyInside("\\\\server\\share\\project", "\\\\server\\share\\project\\file.txt")).toBe(true);
  expect(isLexicallyInside("\\\\server\\share\\project", "\\\\server\\share2\\project\\file.txt")).toBe(false);
  expect(isLexicallyInside("D:\\project", "E:\\project\\file.txt")).toBe(false);
  expect(isLexicallyInside("D:\\project", "D:\\project-extra\\file.txt")).toBe(false);
});

it("keeps legitimate plugin reads but rejects links to another root", () => {
  const { root, project, outside } = fixture();
  setAgentDirOverrideForTests(root);
  const skills = join(root, "skills"); mkdirSync(skills);
  writeFileSync(join(skills, "safe.md"), "safe");
  symlinkSync(outside, join(skills, "linked"), "junction");
  expect(isAllowedPluginPath(join(skills, "safe.md"), project)).toBe(true);
  expect(isAllowedPluginPath(join(skills, "linked", "proof.txt"), project)).toBe(false);
});

it.each(["auth", "models", "settings"])("preserves corrupted %s.json on mutation", async (kind) => {
  const { root } = fixture(); setAgentDirOverrideForTests(root);
  const paths = { agentDir: root, storePath: join(root, "providers.json"), authPath: join(root, "auth.json"), modelsPath: join(root, "models.json") };
  const file = join(root, `${kind}.json`); const corrupt = '{"existing":'; writeFileSync(file, corrupt);
  const mutate = async () => {
    if (kind === "auth") await withAuthLock(paths, async (auth) => { auth.new = { type: "api_key", key: "placeholder" }; await writeAuthFile(paths, auth); });
    else if (kind === "models") await withModelsLock(paths, async (models) => { models.providers = {}; await writeModelsFile(paths, models); });
    else mutatePiSettingsSync((settings) => { settings.shellPath = "test"; });
  };
  await expect(mutate()).rejects.toThrow();
  expect(readFileSync(file, "utf8")).toBe(corrupt);
});

it("disabling one provider does not delete unrelated CLI/catalog providers sharing its URL", async () => {
  const { root } = fixture(); setAgentDirOverrideForTests(root);
  const paths = { agentDir: root, storePath: join(root, "providers.json"), authPath: join(root, "auth.json"), modelsPath: join(root, "models.json") };
  const profile = { id: "old", name: "old", providerId: "old", enabled: false, baseUrl: "https://shared.example", api: "openai-completions", apiKey: "placeholder", models: [{ id: "model" }] };
  writeFileSync(paths.storePath, JSON.stringify({ version: 1, activeId: null, profiles: [profile, { ...profile, id: "other", providerId: "other", enabled: true }] }));
  writeFileSync(paths.authPath, JSON.stringify({ old: { type: "api_key", key: "old" }, other: { type: "api_key", key: "other" }, "cli-only": { type: "oauth", access: "placeholder", futureField: true } }));
  const model = { baseUrl: profile.baseUrl, models: [{ id: "model" }] };
  writeFileSync(paths.modelsPath, JSON.stringify({ futureField: "keep", providers: { old: model, other: model, "cli-only": model } }));
  await pruneProviderIdFromPi("old", paths);
  const models = JSON.parse(readFileSync(paths.modelsPath, "utf8"));
  expect(Object.keys(models.providers).sort()).toEqual(["cli-only", "other"]);
  expect(models.futureField).toBe("keep");
  expect(JSON.parse(readFileSync(paths.authPath, "utf8"))["cli-only"].futureField).toBe(true);
});
