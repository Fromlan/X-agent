/**
 * Prefs recovery: corrupt x-agent.json is backed up; defaults returned.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPrefs,
  loadPrefsWithRecovery,
  setAgentDirOverrideForTests,
} from "../electron/agent/prefs";
import { DEFAULT_PREFS } from "../shared/ipc";

const root = mkdtempSync(join(tmpdir(), "x-agent-prefs-recovery-"));
setAgentDirOverrideForTests(root);

try {
  writeFileSync(join(root, "x-agent.json"), "{ not-json", "utf8");

  const result = loadPrefsWithRecovery();
  assert.equal(result.ok, false);
  assert.ok(result.recovered);
  assert.equal(result.recovered.backedUp, true);
  assert.ok(
    result.recovered.backupPath && existsSync(result.recovered.backupPath),
  );
  assert.equal(result.prefs.themeId, DEFAULT_PREFS.themeId);
  assert.equal(result.prefs.autoCompactPercent, 0);
  assert.equal(result.prefs.clientLogoId, "default",
    "corrupt-file recovery yields default clientLogoId");
  assert.ok(!("updateSource" in result.prefs));

  const again = loadPrefs();
  assert.equal(again.themeId, "default");
  assert.ok(existsSync(join(root, "x-agent.json")));

  const bak = readdirSync(root).filter((n) =>
    n.startsWith("x-agent.json.broken-"),
  );
  assert.ok(bak.length >= 1);

  // Valid file still loads with updateSource stripped via normalize.
  writeFileSync(
    join(root, "x-agent.json"),
    JSON.stringify({
      themeId: "nord",
      colorMode: "light",
      updateSource: "gitee",
      autoCompactPercent: 85,
    }),
    "utf8",
  );
  const ok = loadPrefsWithRecovery();
  assert.equal(ok.ok, true);
  assert.equal(ok.prefs.themeId, "nord");
  assert.equal(ok.prefs.colorMode, "light");
  assert.equal(ok.prefs.autoCompactPercent, 85);
  assert.equal(ok.prefs.clientLogoId, "default",
    "recovered-but-valid file without clientLogoId yields default");
} finally {
  setAgentDirOverrideForTests(null);
  rmSync(root, { recursive: true, force: true });
}

console.log("prefs recovery: ok");
