/**
 * Offline tests for package registry helpers + prune / name lookup.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { setAgentDirOverrideForTests } from "../electron/agent/prefs";
import {
  dropRegistryPackagesBySource,
  findLivePackageSourcesByName,
  isResolvablePackageSource,
  isSafePackageSource,
  listInstalledPackages,
  packageNameForSource,
  pruneMissingPiPackageSources,
  readPiSettingsPackageSources,
  reconcilePackageCatalog,
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

// pi CLI records local installs in settings.json `packages` relative to
// ~/.pi/agent (e.g. `..\..\AppData\...\resources\godot-pi`). Resolving those
// against process.cwd() made them look "missing", so prune wiped the install.
// Regression: relative sources must resolve against the agent dir.
const relHome = mkdtempSync(join(tmpdir(), "x-agent-pkg-rel-"));
const relOutside = mkdtempSync(join(tmpdir(), "x-agent-pkg-outside-"));
const relPkg = join(relOutside, "rel-godot-pi");
mkdirSync(relPkg, { recursive: true });
writeFileSync(
  join(relPkg, "package.json"),
  JSON.stringify({ name: "@x-agent/godot-pi", version: "0.1.0" }),
  "utf8",
);
setAgentDirOverrideForTests(relHome);
try {
  // Mirrors pi's normalizePackageSourceForSettings: relative(agentDir, pkg).
  const relSource = relative(relHome, relPkg);
  assert(!isAbsolute(relSource), "pi writes a relative source");
  writePiSettingsPackageSources([relSource]);
  writeFileSync(
    join(relHome, "x-agent-packages.json"),
    JSON.stringify({
      packages: [pkg("@x-agent/godot-pi", relPkg)],
    }),
    "utf8",
  );

  assert(
    isResolvablePackageSource(relSource),
    `agentDir-relative source resolvable: ${relSource}`,
  );
  assert.equal(packageNameForSource(relSource), "@x-agent/godot-pi");

  const pruned = pruneMissingPiPackageSources();
  assert.deepEqual(pruned.removed, [], "relative live source survives prune");
  assert.deepEqual(
    readPiSettingsPackageSources(),
    [relSource],
    "settings entry keeps pi's relative form",
  );

  const listed = listInstalledPackages();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.name, "@x-agent/godot-pi");
  assert.ok(existsSync(listed[0]!.source), "lists absolute resolvable path");

  const godotRel = findLivePackageSourcesByName("@x-agent/godot-pi");
  assert.equal(godotRel.length, 1, "findLive finds relative source");

  const reconciled = reconcilePackageCatalog();
  assert.equal(reconciled.removedSettings.length, 0);
  assert.equal(reconciled.removedRegistry, 0, "registry row survives reconcile");
  const regRaw = JSON.parse(
    readFileSync(join(relHome, "x-agent-packages.json"), "utf8"),
  ) as { packages: InstalledPackageInfo[] };
  assert.equal(regRaw.packages.length, 1, "x-agent-packages.json not wiped");
  assert.equal(
    dropRegistryPackagesBySource(regRaw.packages, relSource).length,
    0,
    "relative source matches registry absolute key",
  );
} finally {
  setAgentDirOverrideForTests(null);
  rmSync(relHome, { recursive: true, force: true });
  rmSync(relOutside, { recursive: true, force: true });
}

// Same package name from settings + Temp registry orphan → list shows one.
const agentHome2 = mkdtempSync(join(tmpdir(), "x-agent-pkg-dedupe-"));
const stable = join(agentHome2, "stable-godot-pi");
const ephemeral = join(agentHome2, "Temp", "extract-abc", "resources", "godot-pi");
mkdirSync(stable, { recursive: true });
mkdirSync(ephemeral, { recursive: true });
const manifest = JSON.stringify({ name: "@x-agent/godot-pi", version: "0.2.0" });
writeFileSync(join(stable, "package.json"), manifest, "utf8");
writeFileSync(join(ephemeral, "package.json"), manifest, "utf8");
setAgentDirOverrideForTests(agentHome2);
try {
  writePiSettingsPackageSources([stable]);
  writeFileSync(
    join(agentHome2, "x-agent-packages.json"),
    JSON.stringify({
      packages: [
        pkg("@x-agent/godot-pi", ephemeral),
        pkg("@x-agent/godot-pi", stable),
      ],
    }),
    "utf8",
  );
  const listed = listInstalledPackages();
  assert.equal(listed.length, 1, "dedupe to one package name");
  assert.ok(
    listed[0]!.source.toLowerCase().includes("stable-godot-pi"),
    "keeps settings / non-temp path",
  );
  const reconciled = reconcilePackageCatalog();
  assert.ok(reconciled.removedRegistry >= 0);
  const listedAgain = listInstalledPackages();
  assert.equal(listedAgain.length, 1);
} finally {
  setAgentDirOverrideForTests(null);
  rmSync(agentHome2, { recursive: true, force: true });
}

// Source whitelist gate (command injection surface via `pi install <source>`).
const gateHome = mkdtempSync(join(tmpdir(), "x-agent-pkg-gate-"));
const gateDir = join(gateHome, "local-pkg");
mkdirSync(gateDir, { recursive: true });
try {
  for (const bad of ["a&echo PWNED", "npm:x | calc", "C:\\proj;del /f x", "`whoami`", "%COMSPEC%", "dir && echo x", ""]) {
    assert.equal(isSafePackageSource(bad), false, `reject unsafe source: ${bad}`);
  }
  assert.equal(isSafePackageSource("npm:@scope/pkg"), true, "npm spec ok");
  assert.equal(isSafePackageSource("git+https://example.com/repo.git"), true, "git+ spec ok");
  assert.equal(isSafePackageSource("ssh://git@example.com/repo.git"), true, "ssh spec ok");
  assert.equal(isSafePackageSource("https://example.com/x?a=1&b=2"), true, "https URL ok");
  assert.equal(isSafePackageSource("npm:@scope/pkg with space"), false, "whitespace spec rejected");
  assert.equal(isSafePackageSource(gateDir), true, "existing local dir ok");
  assert.equal(isSafePackageSource(join(gateHome, "missing-dir")), false, "missing local dir rejected");
  assert.equal(isSafePackageSource("some-bare-name"), false, "bare name rejected");
} finally {
  rmSync(gateHome, { recursive: true, force: true });
}

console.log("test-package-manager: ok");