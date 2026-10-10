/** Inject real read/write failures to verify corruption never changes a previously committed configuration. */
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as fs from "node:fs/promises";
vi.mock("node:fs/promises", { spy: true });
import { readJsonStrict, writeJsonAtomic } from "./atomic-write";
import { createStore } from "./store";

const dirs: string[] = [];
/** Create a private test file, leaving user configuration untouched. */
function file() {
  const dir = mkdtempSync(join(tmpdir(), "x-agent-atomic-fault-")); dirs.push(dir);
  const path = join(dir, "config.json"); writeFileSync(path, '{"old":true}');
  return { path, dir };
}
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it.each(["writeFile", "rename"] as const)("preserves old content and removes credential temp files on %s failure", async (operation) => {
  const { path, dir } = file();
  vi.mocked(fs[operation]).mockRejectedValueOnce(Object.assign(new Error("simulated"), { code: "EPERM" }));
  await expect(writeJsonAtomic(path, { secret: "placeholder" })).rejects.toThrow("simulated");
  expect(readFileSync(path, "utf8")).toBe('{"old":true}');
  expect(readdirSync(dir)).toEqual(["config.json"]);
});

it("does not turn a permission failure into an empty default", async () => {
  const { path } = file();
  vi.mocked(fs.readFile).mockRejectedValueOnce(Object.assign(new Error("placeholder-secret"), { code: "EACCES" }));
  await expect(readJsonStrict(path, {})).rejects.toThrow("EACCES");
  expect(readFileSync(path, "utf8")).toBe('{"old":true}');
});

it("blocks mutations of corrupt stores and preserves cached committed state on rename failure", async () => {
  const { path } = file();
  const store = createStore({ filePath: path, defaults: { old: false } });
  expect(store.read()).toEqual({ old: true });
  vi.mocked(fs.rename).mockRejectedValueOnce(new Error("locked"));
  await expect(store.mutate(() => ({ old: false }))).rejects.toThrow("locked");
  expect(store.read()).toEqual({ old: true });
  writeFileSync(path, '{"old":');
  await expect(store.mutate(() => ({ old: false }))).rejects.toThrow(/损坏/);
  expect(readFileSync(path, "utf8")).toBe('{"old":');
});
