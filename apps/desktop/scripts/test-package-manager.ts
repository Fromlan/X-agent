/**
 * Offline tests for package registry source matching / drop helper.
 */
import assert from "node:assert/strict";
import { dropRegistryPackagesBySource } from "../electron/agent/package-manager";
import type { InstalledPackageInfo } from "../shared/ipc";

function pkg(
  name: string,
  source: string,
): InstalledPackageInfo {
  return { name, source, installedAt: "2026-01-01T00:00:00.000Z" };
}

const list = [
  pkg("godot-pi", "D:/UGit/X-agent/packages/godot-pi"),
  pkg("other", "npm:@example/other"),
  pkg("dup-slash", "D:\\UGit\\X-agent\\packages\\godot-pi"),
];

const dropped = dropRegistryPackagesBySource(
  list,
  "D:/UGit/X-agent/packages/godot-pi",
);
assert.equal(dropped.length, 1, "drops both slash styles of same source");
assert.equal(dropped[0]!.name, "other");

const droppedNpm = dropRegistryPackagesBySource(list, "npm:@example/other");
assert.equal(droppedNpm.length, 2);
assert.ok(droppedNpm.every((p) => p.name !== "other"));

const noop = dropRegistryPackagesBySource(list, "npm:@missing/pkg");
assert.equal(noop.length, 3, "unknown source leaves list unchanged");

console.log("test-package-manager: ok");
