/**
 * Vitest 套件 —— `runSessionAbort` 独立单测 (issue #3 主题 E).
 *
 * 通过 mock `SessionAbortHost` 验证 abort pipeline 的 4 条核心契约:
 *   1. 无 bundle → ok:false (不调 session.abort)
 *   2. 正常 abort → setStatus("idle") + ok:true, cancelled:true
 *   3. abort 抛错 + 仍 streaming → setStatus("error") + emitReplaceableNotice("session")
 *   4. abort 抛错 + 已停 → setStatus("idle") + ok:true, cancelled:true
 *   5. abort 期间 bundle 切换 → ok:true (no setStatus, no notice)
 *
 * 不依赖真 AgentSession / Pi SDK / electron IPC。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSessionAbort, type SessionAbortHost } from "./session-abort";
import type { SessionBundle } from "./session-lifecycle";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type FakeSession = AgentSession & {
  abort: ReturnType<typeof vi.fn>;
  isStreaming: boolean;
};

function makeSession(overrides: {
  streaming?: boolean;
  abortImpl?: () => Promise<void>;
} = {}): FakeSession {
  return {
    abort: vi.fn(overrides.abortImpl ?? (async () => {})),
    isStreaming: overrides.streaming ?? false,
  } as unknown as FakeSession;
}

function makeBundle(session: FakeSession): SessionBundle {
  return {
    session: session as unknown as AgentSession,
    unsubscribe: () => {},
    cwd: "/tmp/proj",
    sessionPath: null,
    sessionType: "code",
  };
}

function makeHost(overrides: { bundle?: SessionBundle | null } = {}) {
  const setStatus = vi.fn();
  const emitReplaceableNotice = vi.fn();
  let currentBundle: SessionBundle | null =
    overrides.bundle === null
      ? null
      : (overrides.bundle ?? makeBundle(makeSession()));

  const host: SessionAbortHost = {
    getBundle: () => currentBundle,
    setStatus,
    emitReplaceableNotice,
  };

  return {
    host,
    setStatus,
    emitReplaceableNotice,
    /** Replace the bundle mid-flight to simulate dispose → openProject. */
    switchBundle(next: SessionBundle | null) {
      currentBundle = next;
    },
  };
}

describe("runSessionAbort", () => {
  let ctx: ReturnType<typeof makeHost>;
  beforeEach(() => {
    ctx = makeHost();
  });

  it("returns ok:false when there is no bundle", async () => {
    ctx = makeHost({ bundle: null });
    const result = await runSessionAbort(ctx.host);
    expect(result).toEqual({ ok: false });
    expect(ctx.setStatus).not.toHaveBeenCalled();
    expect(ctx.emitReplaceableNotice).not.toHaveBeenCalled();
  });

  it("happy path: setStatus('idle') + ok:true, cancelled:true", async () => {
    const session = makeSession();
    ctx = makeHost({ bundle: makeBundle(session) });
    const result = await runSessionAbort(ctx.host);
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(ctx.setStatus).toHaveBeenCalledWith("idle");
    expect(ctx.emitReplaceableNotice).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, cancelled: true });
  });

  it("abort throws + still streaming → error status + notice + ok:false", async () => {
    const session = makeSession({
      streaming: true,
      abortImpl: async () => {
        throw new Error("transport down");
      },
    });
    ctx = makeHost({ bundle: makeBundle(session) });
    const result = await runSessionAbort(ctx.host);
    expect(ctx.setStatus).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("transport down"),
    );
    expect(ctx.emitReplaceableNotice).toHaveBeenCalledWith(
      "session",
      expect.stringContaining("transport down"),
      "error",
    );
    expect(result).toEqual({ ok: false, cancelled: false });
  });

  it("abort throws + already stopped → setStatus('idle') (defensive)", async () => {
    const session = makeSession({
      streaming: false,
      abortImpl: async () => {
        throw new Error("late error");
      },
    });
    ctx = makeHost({ bundle: makeBundle(session) });
    const result = await runSessionAbort(ctx.host);
    expect(ctx.setStatus).toHaveBeenCalledWith("idle");
    expect(ctx.emitReplaceableNotice).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, cancelled: true });
  });

  it("bundle switched during abort → ok:true, no status flip, no notice", async () => {
    let resolveAbort: (() => void) | undefined;
    const session = makeSession({
      abortImpl: () =>
        new Promise<void>((res) => {
          resolveAbort = res;
        }),
    });
    ctx = makeHost({ bundle: makeBundle(session) });
    const promise = runSessionAbort(ctx.host);
    // Caller disposed & opened a new bundle before abort resolved.
    ctx.switchBundle(
      makeBundle(makeSession()) as unknown as SessionBundle,
    );
    resolveAbort!();
    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(ctx.setStatus).not.toHaveBeenCalled();
    expect(ctx.emitReplaceableNotice).not.toHaveBeenCalled();
  });
});
