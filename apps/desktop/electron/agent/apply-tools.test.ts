/** Verify tool configuration commits and rollback against isolated real prefs and injected session behavior. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyTools, type ApplyToolsDeps } from "./apply-tools";
import { patchPrefs, getCachedPrefs, setAgentDirOverrideForTests } from "./prefs";

let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "x-agent-tool-config-"));
  setAgentDirOverrideForTests(dir);
  await patchPrefs({ tools: ["read"] });
});
afterEach(() => { setAgentDirOverrideForTests(null); rmSync(dir, { recursive: true, force: true }); });

/** Construct a session seam that can fail once, then prove rollback restores the real previous state. */
function fixture(readonly = false) {
  let active = ["read"];
  const setter = vi.fn((tools: string[]) => { active = [...tools]; });
  const bundle = { session: { getActiveToolNames: () => active, setActiveToolsByName: setter } };
  const deps: ApplyToolsDeps = {
    getBundle: () => bundle as never,
    isReadonlyMode: () => readonly,
    applyReadonlyModeTools: vi.fn(() => ({ ok: true })),
    rebuildSession: vi.fn(async () => ({ ok: false, error: "rebuild failed" })),
    emitReplaceableNotice: vi.fn(),
  };
  return { deps, setter, active: () => active };
}

it("returns only after disk and runtime have both committed", async () => {
  const f = fixture();
  expect(await applyTools(f.deps, ["read", "write"])).toEqual({ ok: true });
  expect(getCachedPrefs().tools).toEqual(["read", "write"]);
  expect(JSON.parse(readFileSync(join(dir, "x-agent.json"), "utf8")).tools).toEqual(["read", "write"]);
  expect(f.active()).toEqual(["read", "write"]);
});

it("restores prefs and runtime after an apply failure", async () => {
  const f = fixture(); f.setter.mockImplementationOnce(() => { throw new Error("apply failed"); });
  expect(await applyTools(f.deps, ["write"])).toMatchObject({ ok: false, error: "apply failed" });
  expect(getCachedPrefs().tools).toEqual(["read"]); expect(f.active()).toEqual(["read"]);
});

it("does not change runtime when persistence fails", async () => {
  const f = fixture(); writeFileSync(join(dir, "x-agent.json"), "{corrupt");
  expect((await applyTools(f.deps, ["write"])).ok).toBe(false);
  expect(f.setter).not.toHaveBeenCalled();
  expect(readFileSync(join(dir, "x-agent.json"), "utf8")).toBe("{corrupt");
});

it("restores the readonly saved tool snapshot after failure", async () => {
  const f = fixture(true);
  vi.mocked(f.deps.applyReadonlyModeTools).mockReturnValueOnce({ ok: false, error: "readonly failure" });
  expect((await applyTools(f.deps, ["write"])).ok).toBe(false);
  expect(f.deps.applyReadonlyModeTools).toHaveBeenLastCalledWith(["read"]);
  expect(getCachedPrefs().tools).toEqual(["read"]);
});

it("returns rebuild failure rather than claiming tools are active", async () => {
  const f = fixture(); f.setter.mockImplementationOnce(() => {});
  expect((await applyTools(f.deps, ["write"])).ok).toBe(false);
  expect(f.deps.rebuildSession).toHaveBeenCalled();
  expect(getCachedPrefs().tools).toEqual(["read"]); expect(f.active()).toEqual(["read"]);
});
