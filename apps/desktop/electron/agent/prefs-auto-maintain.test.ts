/**
 * Vitest suite for the auto-maintain / auto-snip prefs plumbing in
 * `prefs.ts`. Covers normalize clamp rules and patchPrefs persistence.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPrefs,
  patchPrefs,
  setAgentDirOverrideForTests,
} from "./prefs";
import type { ClientPrefs } from "../../shared/ipc";
import { DEFAULT_PREFS } from "../../shared/ipc";

let AGENT_DIR: string;

beforeAll(() => {
  AGENT_DIR = mkdtempSync(join(tmpdir(), "x-agent-prefs-vitest-"));
  setAgentDirOverrideForTests(AGENT_DIR);
});

afterAll(() => {
  setAgentDirOverrideForTests(null);
  if (existsSync(AGENT_DIR)) {
    rmSync(AGENT_DIR, { recursive: true, force: true });
  }
});

describe("DEFAULT_PREFS — auto-maintain defaults", () => {
  it("autoCompactPercent defaults to 80", () => {
    expect(DEFAULT_PREFS.autoCompactPercent).toBe(80);
  });
  it("autoSnipThreshold defaults to 8192", () => {
    expect(DEFAULT_PREFS.autoSnipThreshold).toBe(8192);
  });
  it("autoSnipHeadKeep defaults to 4096", () => {
    expect(DEFAULT_PREFS.autoSnipHeadKeep).toBe(4096);
  });
  it("autoSnipTailKeep defaults to 1024", () => {
    expect(DEFAULT_PREFS.autoSnipTailKeep).toBe(1024);
  });
});

describe("loadPrefs — auto-maintain field normalization", () => {
  it("clamps autoCompactPercent to [0, 100]", async () => {
    writeFileSync(
      join(AGENT_DIR, "x-agent.json"),
      JSON.stringify({ ...DEFAULT_PREFS, autoCompactPercent: 250 }),
      "utf8",
    );
    const p = await patchPrefs({ autoCompactPercent: 250 });
    expect(p.autoCompactPercent).toBe(100);
    const p2 = await patchPrefs({ autoCompactPercent: -5 });
    expect(p2.autoCompactPercent).toBe(0);
  });

  it("clamps autoSnipThreshold to [0, 1_000_000]", async () => {
    const p1 = await patchPrefs({ autoSnipThreshold: 5_000_000 });
    expect(p1.autoSnipThreshold).toBe(1_000_000);
    const p2 = await patchPrefs({ autoSnipThreshold: -100 });
    expect(p2.autoSnipThreshold).toBe(0);
  });

  it("clamps autoSnipHeadKeep / autoSnipTailKeep to [0, 1_000_000]", async () => {
    const p1 = await patchPrefs({ autoSnipHeadKeep: 9_999_999 });
    expect(p1.autoSnipHeadKeep).toBe(1_000_000);
    const p2 = await patchPrefs({ autoSnipHeadKeep: -50 });
    expect(p2.autoSnipHeadKeep).toBe(0);
    const p3 = await patchPrefs({ autoSnipTailKeep: 9_999_999 });
    expect(p3.autoSnipTailKeep).toBe(1_000_000);
  });

  it("loadPrefs reads the persisted thresholds and applies them", () => {
    const p: ClientPrefs = loadPrefs();
    // After the patchPrefs calls above, the latest value should be a valid
    // clamped threshold in [0, 1_000_000].
    expect(p.autoSnipThreshold).toBeGreaterThanOrEqual(0);
    expect(p.autoSnipThreshold).toBeLessThanOrEqual(1_000_000);
    expect(p.autoSnipHeadKeep).toBeGreaterThanOrEqual(0);
    expect(p.autoSnipHeadKeep).toBeLessThanOrEqual(1_000_000);
  });
});
