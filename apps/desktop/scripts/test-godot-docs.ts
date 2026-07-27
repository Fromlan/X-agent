/**
 * Offline unit tests for godot-docs cache helpers + keyword search.
 * Does not clone the full repo (uses a tiny fixture tree).
 */
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  docsSiteVersionForBranch,
  docsUrlForRst,
  getDocsDownloadZipUrl,
  getDocsRoot,
  isDocsUsefulBranch,
  normalizeGodotDocsBranch,
  sortDocsBranches,
} from "../electron/agent/godot-docs-cache";
import { searchGodotDocs } from "../electron/agent/godot-docs-search";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- branch helpers ---
assert(normalizeGodotDocsBranch("stable") === "stable", "stable ok");
assert(normalizeGodotDocsBranch(" master ") === "master", "trim ok");
assert(normalizeGodotDocsBranch("../evil") === "stable", "reject path");
assert(normalizeGodotDocsBranch("") === "stable", "empty → stable");
assert(normalizeGodotDocsBranch("3.6") === "3.6", "3.6 ok");
assert(docsSiteVersionForBranch("master") === "latest", "master → latest");
assert(docsSiteVersionForBranch("stable") === "stable", "stable site");
assert(
  getDocsDownloadZipUrl("4.7") ===
    "https://github.com/godotengine/godot-docs/archive/refs/heads/4.7.zip",
  "download zip url",
);
assert(
  docsUrlForRst("stable", "./classes/class_node.rst") ===
    "https://docs.godotengine.org/en/stable/classes/class_node.html",
  "strip ./ in url",
);
assert(
  docsUrlForRst("master", "tutorials/scripting/index.rst") ===
    "https://docs.godotengine.org/en/latest/tutorials/scripting.html",
  "index strip + latest",
);

assert(isDocsUsefulBranch("4.7"), "4.7 useful");
assert(isDocsUsefulBranch("stable"), "stable useful");
assert(!isDocsUsefulBranch("classref/sync-c12e519"), "reject classref");
assert(!isDocsUsefulBranch("feature/foo"), "reject feature");
const sorted = sortDocsBranches([
  "4.5",
  "classref/sync-ab6c6ee",
  "3.6",
  "master",
  "4.7",
  "stable",
]);
assert(
  sorted.join(",") === "stable,master,4.7,4.5,3.6",
  `sort order: ${sorted.join(",")}`,
);

// --- fixture search ---
const branch = "xagent-test";
const root = getDocsRoot(branch);
if (existsSync(root)) {
  rmSync(root, { recursive: true, force: true });
}
mkdirSync(join(root, "classes"), { recursive: true });
mkdirSync(join(root, "tutorials"), { recursive: true });
// Fake .git so status helpers treat it as ready if needed
mkdirSync(join(root, ".git"), { recursive: true });

writeFileSync(
  join(root, "index.rst"),
  `Godot Docs Test
===============

Welcome.
`,
  "utf8",
);

writeFileSync(
  join(root, "classes", "class_characterbody2d.rst"),
  `CharacterBody2D
===============

.. _class_CharacterBody2D:

The CharacterBody2D node provides move_and_slide for 2D physics characters.

Methods
-------

* move_and_slide()
`,
  "utf8",
);

writeFileSync(
  join(root, "tutorials", "signals.rst"),
  `Using signals
=============

Connect a signal with connect() or the editor.
`,
  "utf8",
);

const result = await searchGodotDocs({
  query: "move_and_slide",
  branch,
  limit: 5,
  autoEnsure: false,
});

assert(result.ok, `search ok: ${result.error ?? ""}`);
assert(result.branch === branch, "branch echoed");
assert(result.hits.length >= 1, "at least one hit");
assert(
  result.hits.some((h) => h.relPath.includes("class_characterbody2d")),
  "hit class file",
);
assert(
  result.hits.every((h) => h.absPath && !h.relPath.startsWith("./")),
  "absPath set and relPath normalized",
);
assert(
  result.hits[0]!.docsUrl.includes("xagent-test") &&
    !result.hits[0]!.docsUrl.includes("/./"),
  "docsUrl uses branch without ./",
);

const filtered = await searchGodotDocs({
  query: "signal",
  branch,
  pathGlob: "tutorials/*",
  autoEnsure: false,
});
assert(filtered.ok, "filtered search ok");
assert(
  filtered.hits.every((h) => h.relPath.startsWith("tutorials/")),
  "path_glob respected",
);

const empty = await searchGodotDocs({
  query: "zzzz-not-a-real-term-zzzz",
  branch,
  autoEnsure: false,
});
assert(empty.ok, "empty search still ok");
assert(empty.hits.length === 0, "no false hits");

// cleanup
rmSync(root, { recursive: true, force: true });

console.log("test-godot-docs: ok");
