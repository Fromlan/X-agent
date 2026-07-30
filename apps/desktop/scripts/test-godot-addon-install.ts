/**
 * findSourceAddonDir must resolve the monorepo addon even when the module is
 * loaded from electron-vite's out/main/chunks (not electron/agent source).
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findSourceAddonDir } from "../electron/agent/godot-addon-install";

const found = findSourceAddonDir();
assert.ok(found, "findSourceAddonDir should find workspace addon");
assert.ok(
  existsSync(join(found!, "plugin.cfg")),
  `plugin.cfg missing under ${found}`,
);
assert.match(
  found!.replace(/\\/g, "/"),
  /packages\/godot-editor-rpc\/addons\/x_agent_rpc$/,
  `unexpected addon path: ${found}`,
);

console.log("test-godot-addon-install: ok");
console.log(`  source: ${found}`);
