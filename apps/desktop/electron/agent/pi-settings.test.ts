/**
 * Vitest unit test for `electron/agent/pi-settings` (read-modify-write atomically).
 *
 * Why it matters: `~/.pi/agent/settings.json` is shared with the Pi CLI and
 * written by both X-agent (bash shellPath, package sources) and Pi itself.
 * We must (1) preserve every other field the other writer puts there, (2) keep
 * the on-disk file atomic so a crash mid-write can never truncate the previous
 * good copy, and (3) recover from a corrupt file rather than crash the app.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  piSettingsPath,
  mutatePiSettingsSync,
  readPiSettingsSync,
} from "./pi-settings";
import { setAgentDirOverrideForTests } from "./prefs";

describe("pi-settings (atomic read-modify-write of ~/.pi/agent/settings.json)", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x-agent-pi-settings-"));
    setAgentDirOverrideForTests(tempDir);
  });
  afterEach(() => {
    setAgentDirOverrideForTests(null);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("piSettingsPath() resolves to <agentDir>/settings.json", () => {
    expect(piSettingsPath()).toBe(join(tempDir, "settings.json"));
  });

  it("first mutate creates the file with the patched content", () => {
    expect(existsSync(piSettingsPath())).toBe(false);
    mutatePiSettingsSync((s) => {
      s.shellPath = "/usr/bin/bash";
    });
    expect(existsSync(piSettingsPath())).toBe(true);
    expect(readPiSettingsSync()).toEqual({ shellPath: "/usr/bin/bash" });
  });

  it("subsequent mutates preserve fields written by previous mutates (no clobber)", () => {
    mutatePiSettingsSync((s) => {
      s.shellPath = "/bin/bash";
    });
    mutatePiSettingsSync((s) => {
      s.packageSources = ["npm:foo"];
    });
    const final = readPiSettingsSync();
    expect(final.shellPath).toBe("/bin/bash");
    expect(final.packageSources).toEqual(["npm:foo"]);
  });

  it("corrupted JSON file → mutate recovers without throwing", () => {
    writeFileSync(piSettingsPath(), "{not valid json", "utf8");
    mutatePiSettingsSync((s) => {
      s.shellPath = "/usr/bin/zsh";
    });
    expect(readPiSettingsSync()).toEqual({ shellPath: "/usr/bin/zsh" });
  });

  it("non-object JSON root (array) → mutate replaces with fresh object", () => {
    writeFileSync(piSettingsPath(), "[1,2,3]", "utf8");
    mutatePiSettingsSync((s) => {
      s.shellPath = "/bin/sh";
    });
    expect(readPiSettingsSync()).toEqual({ shellPath: "/bin/sh" });
  });

  it("no .tmp sibling left behind after a successful mutate", () => {
    mutatePiSettingsSync((s) => {
      s.x = 1;
    });
    const siblings = readdirSync(tempDir).filter((f) => f.endsWith(".tmp"));
    expect(siblings).toEqual([]);
  });

  it("concurrent mutates from the same JS tick serialize via atomic rename", () => {
    // Same lock invariant as the real path: two reads-then-writes in the same
    // microtask must both persist (no overwrite). JS is single-threaded so this
    // is a happy-path sanity check, not a race detector.
    mutatePiSettingsSync((s) => {
      s.a = "first";
    });
    mutatePiSettingsSync((s) => {
      s.b = "second";
    });
    expect(readPiSettingsSync()).toEqual({ a: "first", b: "second" });
  });
});
