/** Verify known request rejections cannot enter fatal renderer recovery through the real IPC handler. */
import { beforeEach, expect, it, vi } from "vitest";
import { registerCoreIpc } from "./register-core-ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";

const mocks = vi.hoisted(() => ({ record: vi.fn(), stop: vi.fn(async () => {}), dialog: vi.fn(() => new Promise(() => {})) }));
vi.mock("electron", () => ({ app: { getVersion: () => "0.6.6" }, dialog: { showMessageBox: mocks.dialog } }));
vi.mock("../agent/pi-cli", () => ({ openPiLogin: vi.fn() }));
vi.mock("../app-runtime", () => ({ stopTurnForRecovery: mocks.stop }));
vi.mock("../boot/diagnostics", async (original) => ({ ...await original<typeof import("../boot/diagnostics")>(), recordDiagnostic: mocks.record }));

/** Register the actual core handlers with isolated host and Electron dependencies. */
function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const notice = vi.fn();
  registerCoreIpc({ handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) } as never, {
    sessionHost: { reportRequestFailure: notice } as never,
    openExternalHttpUrl: vi.fn(), revealMainWindow: vi.fn(), consumePrefsRecoveryNotice: () => null,
    consumeStartupIssues: () => [], getGodotClientCount: () => 0,
  });
  return { report: (value?: unknown) => handlers.get(IPC_CHANNELS.reportRendererFailure)!({}, value), notice };
}

beforeEach(() => { vi.clearAllMocks(); });

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

it.each([undefined, { kind: "rejection", reason: "TypeError" }, { kind: "error", reason: "network" }, { kind: "rejection", reason: "private source" }])("preserves fatal recovery for runtime or invalid reports: %j", async (value) => {
  const f = fixture();
  await f.report({ kind: "rejection", reason: "network" });
  await f.report(value); await f.report(value);
  expect(mocks.stop).toHaveBeenCalledTimes(1); expect(mocks.dialog).toHaveBeenCalledTimes(1);
});
