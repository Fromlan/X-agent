/**
 * Offline tests for package registry helpers + prune / name lookup.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setAgentDirOverrideForTests } from "../electron/agent/prefs";
import {
  dropRegistryPackagesBySource,
  findLivePackageSourcesByName,
  isResolvablePackageSource,
  packageNameForSource,
  pruneMissingPiPackageSources,
  readPiSettingsPackageSources,
  writePiSettingsPackageSources,
} from "../electron/agent/package-manager";
import type { InstalledPackageInfo } from "../shared/ipc";

function pkg(name: string, source: string): InstalledPackageInfo {
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

const agentHome = mkdtempSync(join(tmpdir(), "x-agent-pkg-"));
const liveA = join(agentHome, "pkg-a");
const liveB = join(agentHome, "pkg-b");
const dead = join(agentHome, "missing-pkg");
mkdirSync(liveA, { recursive: true });
mkdirSync(liveB, { recursive: true });
writeFileSync(
  join(liveA, "package.json"),
  JSON.stringify({ name: "@x-agent/godot-pi", version: "0.1.0" }),
  "utf8",
);
writeFileSync(
  join(liveB, "package.json"),
  JSON.stringify({ name: "@other/demo", version: "1.0.0" }),
  "utf8",
);

setAgentDirOverrideForTests(agentHome);
try {
  writePiSettingsPackageSources([
    liveA,
    dead,
    liveB,
    "npm:@scope/kept",
  ]);
  writeFileSync(
    join(agentHome, "x-agent-packages.json"),
    JSON.stringify({
      packages: [
        pkg("@x-agent/godot-pi", liveA),
        pkg("ghost", dead),
        pkg("@other/demo", liveB),
      ],
    }),
    "utf8",
  );

  assert(isResolvablePackageSource(liveA), "liveA resolvable");
  assert(!isResolvablePackageSource(dead), "dead not resolvable");
  assert.equal(packageNameForSource(liveA), "@x-agent/godot-pi");

  const pruned = pruneMissingPiPackageSources();
  assert.deepEqual(pruned.removed, [dead], "removes missing path");
  assert.ok(pruned.kept.includes(liveA));
  assert.ok(pruned.kept.includes(liveB));
  assert.ok(pruned.kept.includes("npm:@scope/kept"), "keeps npm spec");

  const after = readPiSettingsPackageSources();
  assert.equal(after.length, 3);
  assert.ok(!after.includes(dead));

  const godotLive = findLivePackageSourcesByName("@x-agent/godot-pi");
  assert.equal(godotLive.length, 1);
  assert.ok(existsSync(godotLive[0]!));
} finally {
  setAgentDirOverrideForTests(null);
  rmSync(agentHome, { recursive: true, force: true });
}

console.log("test-package-manager: ok");
