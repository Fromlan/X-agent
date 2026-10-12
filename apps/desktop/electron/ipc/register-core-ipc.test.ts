/** Verify known request rejections cannot enter fatal renderer recovery through the real IPC handler. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerCoreIpc } from "./register-core-ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { configureDiagnosticState } from "../boot/diagnostics";
import { setAgentDirOverrideForTests } from "../agent/prefs";

const mocks = vi.hoisted(() => ({ record: vi.fn(), stop: vi.fn(async () => {}), dialog: vi.fn(() => new Promise(() => {})), save: vi.fn(), write: vi.fn() }));
vi.mock("electron", () => ({ app: { getVersion: () => "0.6.6" }, dialog: { showMessageBox: mocks.dialog, showSaveDialog: mocks.save } }));
vi.mock("../agent/pi-cli", () => ({ openPiLogin: vi.fn() }));
vi.mock("../app-runtime", () => ({ stopTurnForRecovery: mocks.stop }));
vi.mock("../boot/diagnostics", async (original) => ({ ...await original<typeof import("../boot/diagnostics")>(), recordDiagnostic: mocks.record }));
vi.mock("../agent/lib/atomic-write", async (original) => ({ ...await original<typeof import("../agent/lib/atomic-write")>(), writeJsonAtomic: mocks.write }));

/** Register the actual core handlers with isolated host and Electron dependencies. */
function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const notice = vi.fn();
  const state = { status: "streaming", mode: "plan", sessionActive: true, godotClients: 0 };
  registerCoreIpc({ handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) } as never, {
    sessionHost: { reportRequestFailure: notice, getStatus: () => ({ status: state.status, cwd: "private project" }), getSessionMode: () => ({ mode: state.mode }) } as never,
    openExternalHttpUrl: vi.fn(), revealMainWindow: vi.fn(), consumePrefsRecoveryNotice: () => null,
    consumeStartupIssues: () => [], getGodotClientCount: () => 0,
  });
  return { report: (value?: unknown) => handlers.get(IPC_CHANNELS.reportRendererFailure)!({}, value),
    exportReport: () => handlers.get(IPC_CHANNELS.exportDiagnosticBundle)!({}), notice, state };
}

let dir: string;
beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "x-agent-core-diagnostics-"));
  setAgentDirOverrideForTests(dir);
});
afterEach(() => {
  configureDiagnosticState(null); setAgentDirOverrideForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

it("records network and abort rejections without stopping the turn or requesting exit", async () => {
  const f = fixture();
  for (const reason of ["network", "aborted"]) {
    await expect(f.report({ kind: "rejection", reason, message: "private body" })).resolves.toEqual({ ok: true });
    expect(f.notice).toHaveBeenCalledWith(reason);
    expect(mocks.record).toHaveBeenCalledWith("renderer-rejection", reason);
  }
  expect(mocks.stop).not.toHaveBeenCalled(); expect(mocks.dialog).not.toHaveBeenCalled();
  expect(JSON.stringify(mocks.record.mock.calls)).not.toContain("private");
});

it("exports the pre-dialog snapshot and returns exactly the written evidence for copying", async () => {
  const f = fixture();
  mocks.save.mockImplementation(async () => {
    f.state.status = "idle";
    return { canceled: false, filePath: "support.json" };
  });
  const result = await f.exportReport() as { ok: boolean; snapshot: { state: { status: string }; reportId: string } };
  expect(result.ok).toBe(true);
  expect(result.snapshot.state.status).toBe("streaming");
  expect(mocks.write).toHaveBeenCalledWith("support.json", result.snapshot);
  expect(mocks.save.mock.calls[0]?.[0].defaultPath).toContain(result.snapshot.reportId.slice(0, 8));
  expect(JSON.stringify(result.snapshot)).not.toContain("private");
});

it("does not write a bundle when the Windows save dialog is canceled", async () => {
  mocks.save.mockResolvedValue({ canceled: true });
  await expect(fixture().exportReport()).resolves.toEqual({ ok: false, canceled: true });
  expect(mocks.write).not.toHaveBeenCalled();
});

it("preserves export failures instead of claiming that a diagnostic file was saved", async () => {
  mocks.save.mockResolvedValue({ canceled: false, filePath: "support.json" });
  mocks.write.mockRejectedValueOnce(new Error("permission denied"));
  await expect(fixture().exportReport()).rejects.toThrow();
});

it.each([undefined, { kind: "rejection", reason: "TypeError" }, { kind: "error", reason: "network" }, { kind: "rejection", reason: "private source" }])("preserves fatal recovery for runtime or invalid reports: %j", async (value) => {
  const f = fixture();
  await f.report({ kind: "rejection", reason: "network" });
  await f.report(value); await f.report(value);
  expect(mocks.stop).toHaveBeenCalledTimes(1); expect(mocks.dialog).toHaveBeenCalledTimes(1);
});
