/**
 * Vitest suite — session-event-bridge truncation detection.
 *
 * Locks the rule: when an assistant message ends with stopReason="length"
 * and contains no text / no tool call (only thinking), the host must be
 * notified via `deps.notifyTruncation` so it can inject a recovery prompt.
 *
 * 5 cases:
 *  - 4 on the pure helper `isTruncatedThinkingOnly`
 *  - 1 on `bridgeSessionEvents` calling `deps.notifyTruncation` for a
 *    truncated thinking-only message
 *
 * The bridge integration uses a minimal Pi-AgentSession mock: we only
 * need the `subscribe(handler)` shape. Real Pi events are typed but the
 * bridge is defensive (`as`-cast + null guards), so a hand-rolled
 * fake covers the contract we care about.
 */

import { describe, it, expect, vi } from "vitest";
import { isTruncatedThinkingOnly, bridgeSessionEvents } from "./session-event-bridge";

describe("isTruncatedThinkingOnly", () => {
  it("length + 仅 thinking → true", () => {
    expect(
      isTruncatedThinkingOnly({
        stopReason: "length",
        content: [{ type: "thinking", thinking: "long analysis…" }],
      }),
    ).toBe(true);
  });

  it("length + 包含 text → false (文本已落,模型有输出)", () => {
    expect(
      isTruncatedThinkingOnly({
        stopReason: "length",
        content: [{ type: "text", text: "部分结论" }],
      }),
    ).toBe(false);
  });

  it("length + 包含 toolCall → false (模型已动手,非撞墙)", () => {
    expect(
      isTruncatedThinkingOnly({
        stopReason: "length",
        content: [
          { type: "thinking", thinking: "analyzing…" },
          { type: "toolCall", name: "read" },
        ],
      }),
    ).toBe(false);
  });

  it("stop (end_turn) + 仅 thinking → false (正常 end_turn,非截断)", () => {
    expect(
      isTruncatedThinkingOnly({
        stopReason: "stop",
        content: [{ type: "thinking", thinking: "short" }],
      }),
    ).toBe(false);
  });

  it("length + 空 content → true (撞墙 + 完全无输出,极端 case)", () => {
    expect(
      isTruncatedThinkingOnly({
        stopReason: "length",
        content: [],
      }),
    ).toBe(true);
  });

  it("null / 非对象输入 → false (防御性)", () => {
    expect(isTruncatedThinkingOnly(null)).toBe(false);
    expect(isTruncatedThinkingOnly(undefined)).toBe(false);
    expect(isTruncatedThinkingOnly("not an object")).toBe(false);
    expect(isTruncatedThinkingOnly(42)).toBe(false);
  });
});

describe("bridgeSessionEvents → notifyTruncation hook", () => {
  /**
   * Build a minimal Pi-AgentSession-like object that records its event
   * handler and lets the test push events through it. Real AgentSession
   * has a much wider surface; the bridge only uses `subscribe(handler)`.
   *
   * Important: the SAME object must be returned by `deps.getSession()` and
   * passed to `bridgeSessionEvents` — the bridge drops events where they
   * don't match (defensive against bundle switches mid-turn).
   */
  function makeFakeSession() {
    let handler: ((event: unknown) => void) | null = null;
    const obj = {
      sessionId: "test-session-id",
      subscribe: (h: (event: unknown) => void) => {
        handler = h;
        return () => {
          handler = null;
        };
      },
      push: (event: unknown) => {
        if (!handler) throw new Error("bridge not subscribed");
        handler(event);
      },
    };
    return obj;
  }

  /**
   * Build a minimal deps object — the bridge only touches these fields
   * for the notifyTruncation hook. Real deps has more; we cast to keep
   * the test compact.
   */
  function makeDeps(overrides: Record<string, unknown> = {}) {
    const fakeSession = (overrides.session as ReturnType<typeof makeFakeSession>) ?? makeFakeSession();
    return {
      emit: vi.fn(),
      setStatus: vi.fn(),
      setLastErrorSilently: vi.fn(),
      emitUsageUpdate: vi.fn(),
      emitHistoryReplace: vi.fn(),
      messageIdFrom: () => "msg-id-1",
      toolDetails: new Map(),
      // 关键:getSession 必须返回与 bridgeSessionEvents 第一个参数相同的对象
      getSession: () => fakeSession,
      turn: {
        fileTracker: { getActiveUserEntryId: () => undefined, setActiveUserEntryId: () => {} },
        shadowCheckpoints: { bindPendingPre: () => {}, getCheckpoint: () => undefined, persistDirty: () => {} },
        currentUserEntryId: () => undefined,
      },
      usage: {
        setLastTurnUsage: () => {},
        isCompactionRecording: () => false,
        setCompactionRecording: () => {},
        captureCompactionBaseline: () => {},
        recordCompactionDelta: () => {},
        clearCompactionBaseline: () => {},
      },
      maybeAutoTitleSession: () => Promise.resolve(),
      autoMaintainIfNeeded: () => {},
      onAgentSettled: () => {},
      notifyTruncation: vi.fn(),
      ...overrides,
    };
  }

  it("max_tokens + 仅 thinking → 调用 deps.notifyTruncation({messageId, outputTokens})", () => {
    const fakeSession = makeFakeSession();
    const deps = makeDeps({ session: fakeSession, messageIdFrom: () => "msg-id-1" });

    const unsubscribe = bridgeSessionEvents(
      fakeSession as unknown as Parameters<typeof bridgeSessionEvents>[0],
      deps as unknown as Parameters<typeof bridgeSessionEvents>[1],
    );

    fakeSession.push({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "length",
        content: [{ type: "thinking", thinking: "deep but truncated" }],
        usage: { output: 16384, reasoning: 16383 },
      },
    });

    expect(deps.notifyTruncation).toHaveBeenCalledTimes(1);
    expect(deps.notifyTruncation).toHaveBeenCalledWith({
      messageId: "msg-id-1",
      outputTokens: 16384,
    });

    unsubscribe();
  });

  it("正常 end_turn (stop) → 不调用 notifyTruncation", () => {
    const fakeSession = makeFakeSession();
    const deps = makeDeps({ session: fakeSession, messageIdFrom: () => "msg-id-2" });

    bridgeSessionEvents(
      fakeSession as unknown as Parameters<typeof bridgeSessionEvents>[0],
      deps as unknown as Parameters<typeof bridgeSessionEvents>[1],
    );

    fakeSession.push({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "thinking", thinking: "short" }, { type: "text", text: "done" }],
      },
    });

    expect(deps.notifyTruncation).not.toHaveBeenCalled();
  });

  it("notifyTruncation 未注入时 (老 host) → 不抛错,正常 emit assistant_end", () => {
    const fakeSession = makeFakeSession();
    const emit = vi.fn();
    const deps = {
      ...makeDeps({ session: fakeSession, messageIdFrom: () => "msg-id-3", emit }),
      // 故意不传 notifyTruncation
      notifyTruncation: undefined,
    };

    expect(() =>
      bridgeSessionEvents(
        fakeSession as unknown as Parameters<typeof bridgeSessionEvents>[0],
        deps as unknown as Parameters<typeof bridgeSessionEvents>[1],
      ),
    ).not.toThrow();

    expect(() =>
      fakeSession.push({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "length",
          content: [{ type: "thinking", thinking: "truncated" }],
        },
      }),
    ).not.toThrow();

    // assistant_end 仍正常 emit
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "assistant_end" }),
    );
  });
});
