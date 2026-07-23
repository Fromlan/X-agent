import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPlugin,
  deletePlugin,
  isAllowedPluginPath,
  isValidPluginName,
  listPlugins,
  readPlugin,
  writePlugin,
} from "../electron/agent/plugin-host";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(isValidPluginName("review"), "review ok");
assert(isValidPluginName("a"), "single char ok");
assert(isValidPluginName("my-skill-1"), "hyphen ok");
assert(!isValidPluginName("-bad"), "leading hyphen");
assert(!isValidPluginName("Bad"), "uppercase");
assert(!isValidPluginName("has space"), "space");
assert(!isValidPluginName(""), "empty");

const cwd = mkdtempSync(join(tmpdir(), "alpha-plugin-"));
try {
  const outside = join(tmpdir(), "not-a-plugin.ts");
  assert(!isAllowedPluginPath(outside, cwd), "outside path rejected");

  const created = createPlugin({
    kind: "prompt",
    scope: "project",
    name: "unit-review",
    cwd,
  });
  assert(created.ok && created.item, `create prompt: ${created.error}`);
  assert(existsSync(created.item!.path), "prompt file exists");
  assert(isAllowedPluginPath(created.item!.path, cwd), "created path allowed");

  const listed = listPlugins(cwd).filter(
    (i) => i.kind === "prompt" && i.name === "unit-review",
  );
  assert(listed.length === 1, "listed prompt");

  const read = readPlugin(created.item!.path, cwd);
  assert(read.ok && (read.content ?? "").includes("description:"), "read prompt");

  const written = writePlugin(
    created.item!.path,
    "---\ndescription: updated\n---\n\nHello $1\n",
    cwd,
  );
  assert(written.ok, "write ok");
  assert(readFileSync(created.item!.path, "utf8").includes("Hello $1"), "content updated");

  const badName = createPlugin({
    kind: "skill",
    scope: "project",
    name: "Bad_Name",
    cwd,
  });
  assert(!badName.ok, "invalid name rejected");

  const skill = createPlugin({
    kind: "skill",
    scope: "project",
    name: "unit-skill",
    cwd,
  });
  assert(skill.ok && skill.item, `create skill: ${skill.error}`);
  assert(existsSync(join(skill.item!.path, "SKILL.md")), "SKILL.md exists");

  const ext = createPlugin({
    kind: "extension",
    scope: "project",
    name: "unit-ext",
    cwd,
  });
  assert(ext.ok && ext.item, `create ext: ${ext.error}`);
  assert(existsSync(ext.item!.path), "ext file exists");

  assert(deletePlugin(created.item!.path, cwd).ok, "delete prompt");
  assert(deletePlugin(skill.item!.path, cwd).ok, "delete skill");
  assert(deletePlugin(ext.item!.path, cwd).ok, "delete ext");
  assert(!existsSync(created.item!.path), "prompt gone");
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log("test-plugin-host: ok");
