/** Exercise recovery against tool changes and session replacement without a model or user profile. */
import { describe, expect, it, vi } from "vitest";
import type { PromptPayload, PromptResult } from "../../shared/ipc";
import type { SessionBundle } from "./session-lifecycle";
import {
  buildTruncationRecoveryHint,
  MAX_TRUNCATION_RETRIES,
  notifyTruncation,
  type TruncationRecoveryDeps,
} from "./truncation-recovery";

const DETAIL = { messageId: "truncated-message", outputTokens: 1_000 };

/** Supply only the session surface read by recovery and retain mutable live state. */
function fixture() {
  let tools = ["read", "grep"];
  let retries = 0;
  const original = {
    session: { getActiveToolNames: () => tools },
    cwd: "D:/isolated-game", sessionPath: null, sessionType: "code",
  } as SessionBundle;
  let bundle: SessionBundle | null = original;
  const prompt = vi.fn(async (_payload: PromptPayload): Promise<PromptResult> => ({ ok: true }));
  const setStatus = vi.fn<TruncationRecoveryDeps["setStatus"]>();
  const deps: TruncationRecoveryDeps = {
    getBundle: () => bundle,
    getRetries: () => retries,
    setRetries: (value) => { retries = value; },
    setStatus,
    prompt,
  };
  return {
    deps, prompt, setStatus, original,
    setTools: (names: string[]) => { tools = names; },
    setBundle: (next: SessionBundle | null) => { bundle = next; },
  };
}

/** Drain the scheduled recovery and its settled prompt without a wall-clock sleep. */
async function flushRecovery(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("truncation recovery", () => {
  it("suggests only enabled inspection tools, excluding mutation and unknown tool names", () => {
    const hint = buildTruncationRecoveryHint(["edit", "write", "bash", "run", "godot_run_main_scene", "read", "ls"]);
    expect(hint).toContain("`read`, `ls`");
    for (const tool of ["edit", "write", "bash", "run", "godot_run_main_scene", "grep"]) {
      expect(hint).not.toContain(`\`${tool}\``);
    }
    expect(buildTruncationRecoveryHint([])).toContain("No inspection tool is currently enabled");
  });

  it("uses tools active at dispatch time after a mode or preference change", async () => {
    const f = fixture();
    const pending = notifyTruncation(f.deps, DETAIL);
    f.setTools(["ls"]);
    await pending;
    await flushRecovery();
    expect(f.prompt).toHaveBeenCalledTimes(1);
    expect(f.prompt.mock.calls[0]?.[0].text).toContain("`ls`");
    expect(f.prompt.mock.calls[0]?.[0].text).not.toContain("`read`");
  });

  it("does not send a queued recovery into a replacement session", async () => {
    const f = fixture();
    const pending = notifyTruncation(f.deps, DETAIL);
    f.setBundle({ ...f.original });
    await pending;
    await flushRecovery();
    expect(f.prompt).not.toHaveBeenCalled();
  });

  it("drops recovery when the workspace closes or new user input resets the streak", async () => {
    for (const reset of ["close", "user-input"]) {
      const f = fixture();
      const pending = notifyTruncation(f.deps, DETAIL);
      if (reset === "close") f.setBundle(null);
      else f.deps.setRetries(0);
      await pending;
      await flushRecovery();
      expect(f.prompt).not.toHaveBeenCalled();
    }
  });

  it("coalesces queued notifications into the newest retry", async () => {
    const f = fixture();
    const first = notifyTruncation(f.deps, DETAIL);
    const second = notifyTruncation(f.deps, DETAIL);
    await Promise.all([first, second]);
    await flushRecovery();
    expect(f.prompt).toHaveBeenCalledTimes(1);
  });

  it("stops at the retry cap without assuming a particular model is available", async () => {
    const f = fixture();
    f.deps.setRetries(MAX_TRUNCATION_RETRIES);
    await notifyTruncation(f.deps, DETAIL);
    await flushRecovery();
    expect(f.prompt).not.toHaveBeenCalled();
    expect(f.deps.getRetries()).toBe(MAX_TRUNCATION_RETRIES);
    expect(f.setStatus).toHaveBeenCalledWith("error", expect.stringContaining("其他可用模型"));
  });

  it("invalidates queued recoveries when a later notification reaches the cap", async () => {
    const f = fixture();
    const pending = [notifyTruncation(f.deps, DETAIL), notifyTruncation(f.deps, DETAIL), notifyTruncation(f.deps, DETAIL)];
    await Promise.all(pending);
    await flushRecovery();
    expect(f.prompt).not.toHaveBeenCalled();
    expect(f.setStatus).toHaveBeenLastCalledWith("error", expect.stringContaining("仍被 max_tokens 截断"));
  });

  it("surfaces a rejected recovery so retrying cannot remain stuck", async () => {
    const f = fixture();
    f.prompt.mockResolvedValue({ ok: false, error: "会话正在维护中" });
    await notifyTruncation(f.deps, DETAIL);
    await flushRecovery();
    expect(f.setStatus).toHaveBeenLastCalledWith("error", "自动恢复未能继续：会话正在维护中");
  });

  it("does not publish an old recovery failure into a replacement session", async () => {
    const f = fixture();
    let finish!: (result: PromptResult) => void;
    f.prompt.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await notifyTruncation(f.deps, DETAIL);
    expect(f.prompt).toHaveBeenCalledTimes(1);
    f.setBundle({ ...f.original });
    finish({ ok: false, error: "old failure" });
    await flushRecovery();
    expect(f.setStatus).toHaveBeenCalledTimes(1);
    expect(f.setStatus.mock.calls[0]?.[0]).toBe("retrying");
  });

  it("ignores an old failure when a new user run reuses the same retry number", async () => {
    const f = fixture();
    let finish!: (result: PromptResult) => void;
    f.prompt.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await notifyTruncation(f.deps, DETAIL);
    expect(f.prompt).toHaveBeenCalledTimes(1);
    f.deps.setRetries(0);
    await notifyTruncation(f.deps, { ...DETAIL, messageId: "new-message" });
    await flushRecovery();
    finish({ ok: false, error: "stale same-counter failure" });
    await flushRecovery();
    expect(f.prompt).toHaveBeenCalledTimes(2);
    expect(f.setStatus.mock.calls.map(([status]) => status)).toEqual(["retrying", "retrying"]);
  });

  it("handles a thrown prompt error and skips recovery without a session", async () => {
    const f = fixture();
    f.prompt.mockRejectedValue(new Error("offline failure"));
    await notifyTruncation(f.deps, DETAIL);
    await flushRecovery();
    expect(f.setStatus).toHaveBeenLastCalledWith("error", "自动恢复失败：offline failure");
    f.prompt.mockClear();
    f.setBundle(null);
    await notifyTruncation(f.deps, DETAIL);
    expect(f.prompt).not.toHaveBeenCalled();
  });
});
