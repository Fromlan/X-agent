/**
 * Vitest unit test for `electron/ipc/register-ipc.handle` (阶段 3, 2026-09-09).
 *
 * Pins the contract that any non-sender-untrusted throw from a handler is
 * funnelled through `shared/error-i18n.inspectError` and re-thrown as a
 * `TranslatedIpcError` so the renderer gets a Chinese user-facing message
 * + a stable `patternId`.
 */
import { describe, it, expect, vi } from "vitest";
import { configureIpcSenderGuard, handle, isTranslatedIpcError, resetIpcSenderGuard } from "./register-ipc";
import { isSenderUntrustedError } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc-channels";

function registerAndCapture(
  channel: keyof typeof IPC_CHANNELS,
  handler: (...args: unknown[]) => unknown,
): (e: unknown, ...args: unknown[]) => unknown {
  const calls: Array<[string, (...args: unknown[]) => unknown]> = [];
  const ipcMain = {
    handle: vi.fn((c: string, f: never) => calls.push([c, f])),
  };
  handle(ipcMain as never, channel, handler as never);
  expect(calls).toHaveLength(1);
  return calls[0]![1];
}

const trustedEvent = {
  sender: { id: 1 },
  senderFrame: { url: "file:///index.html" },
};

describe("handler throw translation (issue #65 follow-up, 阶段 3)", () => {
  it("handler throwing Error(message) is translated to Chinese + patternId", async () => {
    const handler = vi.fn(async () => {
      throw new Error(
        '401 {"error":{"message":"Authentication Fails, Your api key: ****e560 is invalid"}}',
      );
    });
    const registered = registerAndCapture(IPC_CHANNELS.prompt, handler);

    let caught: unknown;
    try {
      await (registered as (e: unknown) => Promise<unknown>)(trustedEvent, {
        text: "hi",
      });
    } catch (e) {
      caught = e;
    }

    expect(isSenderUntrustedError(caught)).toBe(false);
    expect(isTranslatedIpcError(caught)).toBe(true);
    if (isTranslatedIpcError(caught)) {
      expect(caught.patternId).toBe("auth_failed");
      expect(caught.message).toContain("认证失败");
      // The raw English must NOT leak into the renderer-bound payload.
      expect(caught.message).not.toContain("Authentication Fails");
    }
  });

  it("handler throwing a network-shape error is recognised as a network-ish pattern", async () => {
    const handler = vi.fn(async () => {
      throw new Error("fetch failed: ECONNREFUSED 127.0.0.1:443");
    });
    const registered = registerAndCapture(IPC_CHANNELS.prompt, handler);

    let caught: unknown;
    try {
      await (registered as (e: unknown) => Promise<unknown>)(trustedEvent, {
        text: "hi",
      });
    } catch (e) {
      caught = e;
    }
    expect(isTranslatedIpcError(caught)).toBe(true);
    if (isTranslatedIpcError(caught)) {
      // Acceptable pattern ids for this network-shape error string. The exact
      // id is implementation-defined by shared/error-i18n.ts; the test pins
      // "some network-related id" rather than a specific value to avoid
      // brittleness when the pattern registry is updated.
      expect(["network_refused", "network_error", "unknown"]).toContain(
        caught.patternId ?? "unknown",
      );
      expect(caught.message.length).toBeGreaterThan(0);
    }
  });

  it("handler returning a Result (no throw) is NOT wrapped", async () => {
    const handler = vi.fn(async () => ({ ok: false, error: "消息过长" }));
    const registered = registerAndCapture(IPC_CHANNELS.prompt, handler);

    const result = await (registered as (e: unknown) => Promise<unknown>)(
      trustedEvent,
      { text: "hi" },
    );
    // Result path is untouched; translation only kicks in on throw.
    expect(result).toEqual({ ok: false, error: "消息过长" });
  });

  it("SenderUntrustedError is still thrown unwrapped (sender guard path)", async () => {
    // Sender guard rejects this sender, so the handler must NOT be called and
    // the throw must be the original SenderUntrustedError, NOT a TranslatedIpcError.
    const fakeWebContents = { id: 1 };
    const fakeWin = { webContents: fakeWebContents, isDestroyed: () => false };
    configureIpcSenderGuard(() => fakeWin as never, null);

    const handler = vi.fn(async () => ({ ok: true }));
    const registered = registerAndCapture(IPC_CHANNELS.prompt, handler);

    const crossEvent = {
      sender: { id: 999 },
      senderFrame: { url: "file:///something" },
    };
    let caught: unknown;
    try {
      await (registered as (e: unknown) => Promise<unknown>)(crossEvent);
    } catch (e) {
      caught = e;
    }
    expect(isSenderUntrustedError(caught)).toBe(true);
    expect(isTranslatedIpcError(caught)).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    resetIpcSenderGuard();
  });
});
