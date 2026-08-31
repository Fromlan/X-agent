import { describe, expect, it, vi } from "vitest";
import {
  DELETED_FLAT_KEYS,
  isSenderUntrustedError,
} from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { configureIpcSenderGuard, handle } from "./register-ipc";

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

describe("isSenderUntrustedError typeguard (issue #65 主题 H)", () => {
  it("识别 __senderUntrusted: true + channel: string 结构", () => {
    const err = { __senderUntrusted: true, channel: "prompt" };
    expect(isSenderUntrustedError(err)).toBe(true);
  });

  it("拒绝普通 Error (无 __senderUntrusted tag)", () => {
    expect(isSenderUntrustedError(new Error("业务错误"))).toBe(false);
    expect(isSenderUntrustedError(new Error("IPC 调用来源不受信任"))).toBe(false);
  });

  it("拒绝 null / undefined / 字符串", () => {
    expect(isSenderUntrustedError(null)).toBe(false);
    expect(isSenderUntrustedError(undefined)).toBe(false);
    expect(isSenderUntrustedError("error")).toBe(false);
  });

  it("拒绝 tag 在但 channel 不是 string", () => {
    expect(isSenderUntrustedError({ __senderUntrusted: true, channel: 123 })).toBe(false);
    expect(isSenderUntrustedError({ __senderUntrusted: true })).toBe(false);
  });

  it("拒绝 __senderUntrusted 不是 boolean true", () => {
    expect(isSenderUntrustedError({ __senderUntrusted: "yes", channel: "x" })).toBe(false);
    expect(isSenderUntrustedError({ __senderUntrusted: false, channel: "x" })).toBe(false);
  });
});

describe("sender guard 集成 (issue #65 主题 H)", () => {
  it("不可信 sender 抛 SenderUntrustedError 契约, handler 不被调", async () => {
    // mock 主窗口: 真实 webContents 与事件 senderFrame 不匹配
    const fakeWin = { webContents: { id: 1 }, isDestroyed: () => false };
    configureIpcSenderGuard(() => fakeWin as never, null);

    const calls: Array<[string, (...args: unknown[]) => unknown]> = [];
    const ipcMain = {
      handle: vi.fn((c: string, f: never) => calls.push([c, f])),
    };
    const handler = vi.fn(async () => ({ ok: true }));

    handle(ipcMain as never, IPC_CHANNELS.prompt, handler as never);

    expect(calls).toHaveLength(1);
    const registered = calls[0]![1];

    // mock 不可信 sender: 不同的 webContents
    const untrustedEvent = {
      sender: { id: 999 }, // 不同于 fakeWin.webContents
      senderFrame: { url: "file:///something" },
    };
    let caught: unknown;
    try {
      await (registered as (e: unknown) => Promise<unknown>)(untrustedEvent);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(isSenderUntrustedError(caught)).toBe(true);
    if (isSenderUntrustedError(caught)) {
      expect(caught.__senderUntrusted).toBe(true);
      expect(caught.channel).toBe(IPC_CHANNELS.prompt);
    }
    expect(handler).not.toHaveBeenCalled();

    // 清理 guard
    configureIpcSenderGuard(() => null, null);
  });
});
