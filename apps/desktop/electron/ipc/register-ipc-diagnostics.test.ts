/** Exercise operation diagnostics through the real sender-guarded IPC wrapper in isolated storage. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setAgentDirOverrideForTests } from "../agent/prefs";
import { configureDiagnosticState, readDiagnosticEvents } from "../boot/diagnostics";
import { configureIpcSenderGuard, handle, resetIpcSenderGuard } from "./register-ipc";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "x-agent-ipc-diagnostics-"));
  setAgentDirOverrideForTests(dir);
  configureDiagnosticState(() => ({ status: "idle", mode: "agent", sessionActive: true, godotClients: 0 }));
});
afterEach(() => {
  resetIpcSenderGuard(); configureDiagnosticState(null); setAgentDirOverrideForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

/** Capture the actual wrapper without involving a running Electron process. */
function fixture(handler: (...args: unknown[]) => unknown) {
  let invoke: (...args: unknown[]) => Promise<unknown>;
  handle({ handle: (_channel: string, fn: typeof invoke) => { invoke = fn; } } as never, "prompt", handler as never);
  return (...args: unknown[]) => invoke({}, ...args);
}

it("records handled Result failures without changing returned values or storing arguments", async () => {
  const result = { ok: false, error: "ETIMEDOUT private source", retryable: true };
  await expect(fixture(async () => result)({ text: "private prompt" })).resolves.toBe(result);
  expect(readDiagnosticEvents()).toMatchObject([{ outcome: "started" }, { outcome: "failed", reason: "network_timeout" }]);
  expect(JSON.stringify(readDiagnosticEvents())).not.toContain("private");
});

it("records throws while preserving the existing translated rejection", async () => {
  await expect(fixture(async () => { throw new Error("ETIMEDOUT private key"); })()).rejects.toMatchObject({ name: "TranslatedIpcError", patternId: "network_timeout" });
  expect(readDiagnosticEvents().at(-1)).toMatchObject({ outcome: "failed", reason: "network_timeout" });
});

it("rejects untrusted senders before tracing or invoking business handlers", async () => {
  configureIpcSenderGuard(() => null, null);
  const handler = vi.fn();
  await expect(fixture(handler)()).rejects.toMatchObject({ __senderUntrusted: true });
  expect(handler).not.toHaveBeenCalled();
  expect(readDiagnosticEvents()).toEqual([]);
});
