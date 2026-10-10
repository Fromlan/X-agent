/** Test fatal callbacks, privacy allowlists and bounded disk records in isolated directories. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setAgentDirOverrideForTests } from "../agent/prefs";
import { diagnosticPath, diagnosticSnapshot, installProcessDiagnostics, normalizeRendererFailure, recordDiagnostic } from "./diagnostics";
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "x-agent-diagnostics-")); setAgentDirOverrideForTests(dir); });
afterEach(() => { setAgentDirOverrideForTests(null); rmSync(dir, { recursive: true, force: true }); });
it("records fatal metadata once and never writes the exception message or stack", () => {
  const emitter = new EventEmitter(); const fatal = vi.fn();
  const dispose = installProcessDiagnostics(emitter, fatal);
  emitter.emit("uncaughtException", new TypeError("placeholder-secret and private project source"));
  emitter.emit("unhandledRejection", "user prompt with credentials");
  expect(fatal).toHaveBeenCalledTimes(1);
  const file = readFileSync(diagnosticPath(), "utf8");
  expect(file).toContain("TypeError"); expect(file).not.toContain("secret"); expect(file).not.toContain("prompt");
  dispose(); expect(emitter.listenerCount("unhandledRejection")).toBe(0);
});
it("drops arbitrary fields and corrupt/untrusted records on export", () => {
  recordDiagnostic("renderer-gone", "crashed");
  writeFileSync(diagnosticPath(), JSON.stringify([{ at: 1, kind: "renderer-gone", reason: "crashed", apiKey: "placeholder" }, { at: 2, kind: "main-exception", reason: "private source text" }]));
  const snapshot = diagnosticSnapshot("0.6.5", { status: "idle", mode: "agent", sessionActive: false, godotClients: 0 });
  expect(snapshot.events).toEqual([{ at: 1, kind: "renderer-gone", reason: "crashed" }]);
  expect(JSON.stringify(snapshot)).not.toContain(dir); expect(JSON.stringify(snapshot)).not.toContain("placeholder");
});

it("accepts only renderer failure enums and exports async categories without raw error bodies", () => {
  expect(normalizeRendererFailure({ kind: "rejection", reason: "network", message: "private source" })).toEqual({ kind: "rejection", reason: "network" });
  expect(normalizeRendererFailure({ kind: "other", reason: "private API key" })).toEqual({ kind: "error", reason: "unknown" });
  expect(normalizeRendererFailure(undefined)).toEqual({ kind: "error", reason: "unknown" });
  recordDiagnostic("renderer-rejection", "network"); recordDiagnostic("renderer-rejection", "aborted");
  const text = JSON.stringify(diagnosticSnapshot("0.6.6", { status: "idle", mode: "agent", sessionActive: true, godotClients: 1 }));
  expect(text).toContain("renderer-rejection"); expect(text).toContain("network"); expect(text).toContain("aborted");
  expect(text).not.toContain("private");
});
