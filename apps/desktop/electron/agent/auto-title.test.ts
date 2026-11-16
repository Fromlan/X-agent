/** Verify native DeepSeek titles avoid an extra model call and still respect user renames. */
import { describe, expect, it, vi } from "vitest";
import { maybeAutoTitleSession } from "./auto-title";
import type { SessionBundle } from "./session-lifecycle";

/** Build the minimal mutable session seam used by the one-shot title coordinator. */
function fixture(currentName?: string) {
  const setSessionName = vi.fn();
  const bundle = { session: {
    messages: [
      { role: "user", content: "帮我实现背包", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "已实现" }], deepseekChatbot: { version: 1, title: "背包系统实现" } },
    ],
    sessionManager: { getSessionName: () => currentName },
    setSessionName, sessionId: "session", model: { provider: "deepseek", id: "deepseek-flash" },
  }, sessionPath: "fixture.jsonl" } as unknown as SessionBundle;
  const ensureRuntime = vi.fn();
  const emit = vi.fn();
  return { bundle, setSessionName, ensureRuntime, emit };
}

describe("native DeepSeek session titles", () => {
  it("uses the response title without another billable model request", async () => {
    const f = fixture();
    await maybeAutoTitleSession({ getBundle: () => f.bundle, ensureRuntime: f.ensureRuntime, emit: f.emit, isInFlight: () => false, setInFlight: vi.fn() });
    expect(f.setSessionName).toHaveBeenCalledWith("背包系统实现");
    expect(f.ensureRuntime).not.toHaveBeenCalled();
    expect(f.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "session_title", name: "背包系统实现" }));
  });

  it("preserves an existing manual name", async () => {
    const f = fixture("用户命名");
    await maybeAutoTitleSession({ getBundle: () => f.bundle, ensureRuntime: f.ensureRuntime, emit: f.emit, isInFlight: () => false, setInFlight: vi.fn() });
    expect(f.setSessionName).not.toHaveBeenCalled();
    expect(f.ensureRuntime).not.toHaveBeenCalled();
  });
});
