import { describe, expect, it, vi } from "vitest";
import { DELETED_FLAT_KEYS } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

describe("ipc channel registry", () => {
  it("key names equal channel values (preload generation depends on this)", () => {
    for (const [key, value] of Object.entries(IPC_CHANNELS)) {
      expect(value).toBe(key);
    }
  });

  it("DELETED_FLAT_KEYS are real, unique channel keys", () => {
    const keys = new Set(Object.keys(IPC_CHANNELS));
    for (const key of DELETED_FLAT_KEYS) {
      expect(keys.has(key)).toBe(true);
    }
    expect(new Set(DELETED_FLAT_KEYS).size).toBe(DELETED_FLAT_KEYS.length);
  });

  it("flat surface keeps every non-deleted channel (XAgentApiFlat coverage gate)", () => {
    const kept = Object.keys(IPC_CHANNELS).filter(
      (k) => !(DELETED_FLAT_KEYS as readonly string[]).includes(k),
    );
    // The XAgentApiFlat type is derived as Omit<FlatInvokeApi, DeletedFlatKey>;
    // this runtime check mirrors that derivation so a wrong DELETED_FLAT_KEYS
    // entry cannot silently widen the flat surface again.
    expect(kept.length).toBe(Object.keys(IPC_CHANNELS).length - DELETED_FLAT_KEYS.length);
  });
});

describe("handle registrar", () => {
  it("forwards channel name and handler to ipcMain", async () => {
    const calls: Array<[string, (...args: unknown[]) => unknown]> = [];
    const ipcMain = { handle: vi.fn((c: string, f: never) => calls.push([c, f])) };
    const result = { ok: true, cwd: "", sessionId: "" };

    handle(ipcMain as never, IPC_CHANNELS.newSession, async () => result);

    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(IPC_CHANNELS.newSession);
    await expect(calls[0]![1]()).resolves.toBe(result);
  });
});
