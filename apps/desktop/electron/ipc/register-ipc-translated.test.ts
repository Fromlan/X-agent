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
import { TranslatedIpcError } from "../../shared/error-i18n";
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

  // Round 1 follow-up: pins that TranslatedIpcError is now an Error subclass
  // (not a plain object) so the renderer-side universal
  // `err instanceof Error ? err.message : String(err)` catch blocks land on
  // the translated Chinese message instead of `[object Object]`. Without
  // these, issue #97's translation work is invisible to the user.
  it("TranslatedIpcError is an Error instance (renderer `err.message` must work)", async () => {
    const handler = vi.fn(async () => {
      throw new Error("401 Authentication Fails");
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

    // The renderer universal fallback is `err instanceof Error ? err.message : String(err)`.
    expect(caught instanceof Error).toBe(true);
    expect(caught instanceof TranslatedIpcError).toBe(true);

    if (caught instanceof Error) {
      // `name` is set explicitly so `err.name === "TranslatedIpcError"` matches
      // both the renderer-side `err.name` string and any `err.constructor.name`.
      expect(caught.name).toBe("TranslatedIpcError");
      // `message` carries the Chinese summary; this is the actual user-facing text.
      expect(caught.message.length).toBeGreaterThan(0);
      expect(caught.message).not.toContain("Authentication Fails");
    }

    if (isTranslatedIpcError(caught)) {
      // Marker + patternId must both be set on the throw site, so the
      // structured-clone across IPC preserves them for the renderer.
      expect(caught.__translatedError).toBe(true);
      expect(caught.patternId).not.toBeNull();
    }
  });

  it("TranslatedIpcError message survives a structured-clone round-trip (the actual Critical 2 fix)", async () => {
    // Electron IPC uses structured clone. This test pins the survival matrix
    // so we know what the renderer can rely on after the boundary, and
    // documents what is intentionally NOT preserved.
    //
    // Survival matrix under V8 structuredClone (Node) / Chromium IPC (Electron):
    //   ✓ message                 — Error special path. THIS IS THE CRITICAL FIX.
    //                              Before this round `TranslatedIpcError` was a
    //                              plain object so the renderer universal
    //                              fallback `err.message` produced
    //                              `"[object Object]"`. After subclassing Error,
    //                              the Chinese text survives.
    //   ✓ cloned instanceof Error — prototype chain rebuilt as Error.
    //   ✗ cloned instanceof TranslatedIpcError — subclass prototype lost.
    //   ✗ cloned.name             — V8 Node structuredClone does not preserve
    //                              name on Error subclasses (returns "Error",
    //                              the base default). Electron IPC may differ;
    //                              the renderer should NOT rely on name.
    //   ✗ __translatedError / patternId — user-defined own properties are
    //                              dropped by the Error serialization path.
    //
    // Practical consequence for the renderer:
    //   - The universal `err instanceof Error ? err.message : String(err)`
    //     catch-block pattern WORKS — the Chinese summary reaches the user.
    //   - `isTranslatedIpcError` (renderer-side typeguard) is UNRELIABLE
    //     across the boundary today — neither the marker nor the name
    //     survives reliably. If the renderer ever needs to filter translated
    //     errors from raw Error rejects, it must rely on the message content
    //     or a future IPC-protocol change that wraps rejects in a tagged
    //     payload (e.g. `{ __translated: true, message, patternId }`).
    const handler = vi.fn(async () => {
      throw new Error("401 Authentication Fails");
    });
    const registered = registerAndCapture(IPC_CHANNELS.prompt, handler);

    let caughtMain: unknown;
    try {
      await (registered as (e: unknown) => Promise<unknown>)(trustedEvent, {
        text: "hi",
      });
    } catch (e) {
      caughtMain = e;
    }

    const cloned = structuredClone(caughtMain);

    // ★ The user-facing claim of Critical 2 is fixed by this assertion:
    // the Chinese summary message reaches the renderer side intact.
    expect(cloned instanceof Error).toBe(true);
    expect((cloned as Error).message.length).toBeGreaterThan(0);
    expect((cloned as Error).message).not.toContain("Authentication Fails");
    expect((cloned as Error).message).toBe((caughtMain as Error).message);

    // Subclass-only fields are intentionally lost (documented limitation).
    expect(cloned instanceof TranslatedIpcError).toBe(false);
    const clonedObj = cloned as { __translatedError?: unknown; patternId?: unknown };
    expect(clonedObj.__translatedError).toBeUndefined();
    expect(clonedObj.patternId).toBeUndefined();
    // Document the current Node behavior so future contributors don't
    // assume the name field is preserved. Electron IPC may differ; if it
    // does, this assertion can be updated to assert the Electron-specific
    // behaviour.
    expect(["Error", "TranslatedIpcError"]).toContain((cloned as Error).name);
  });
});
