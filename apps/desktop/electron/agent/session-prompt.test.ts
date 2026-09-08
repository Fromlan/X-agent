/**
 * Vitest 套件 —— `runSessionPrompt` 独立单测 (issue #3 主题 E).
 *
 * 通过 mock `SessionPromptHost` 验证 prompt pipeline 的 6 条核心契约:
 *   1. 无 bundle / 空输入守卫
 *   2. user-typed prompt 重置截断重试计数
 *   3. recovery prompt 不重置 (marker 命中)
 *   4. extension command 走 silent 返回
 *   5. bundle 切换 (dispose 期间) 返 "会话已切换"
 *   6. 异常路径 → ok:false + setStatus("error", msg)
 *
 * 不依赖真 AgentSession / Pi SDK / electron IPC。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSessionPrompt, type SessionPromptHost } from "./session-prompt";
import { TRUNCATION_RECOVERY_MARKER } from "./truncation-recovery";
import type { SessionBundle } from "./session-lifecycle";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type FakeSession = AgentSession & {
  prompt: ReturnType<typeof vi.fn>;
  isStreaming: boolean;
  promptTemplates: Array<{ name: string; content: string }>;
  extensionRunner: { getCommand: (name: string) => unknown };
};

function makeSession(overrides: {
  streaming?: boolean;
  templates?: Array<{ name: string; content: string }>;
  commands?: Record<string, unknown>;
} = {}): FakeSession {
  return {
    prompt: vi.fn(async () => {}),
    isStreaming: overrides.streaming ?? false,
    promptTemplates: overrides.templates ?? [],
    extensionRunner: {
      getCommand: (name: string) =>
        overrides.commands?.[name] ?? undefined,
    },
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

interface MockOverrides {
  bundle?: SessionBundle | null;
  resetTruncationRetries?: ReturnType<typeof vi.fn>;
}

function makeHost(overrides: MockOverrides = {}) {
  const setStatus = vi.fn();
  const isPreparing = vi.fn(() => false);
  const setPreparing = vi.fn();
  const prepareShadowCheckpoint = vi.fn(async () => {});
  const resetTruncationRetries =
    overrides.resetTruncationRetries ?? vi.fn();

  let currentBundle: SessionBundle | null =
    overrides.bundle === null
      ? null
      : (overrides.bundle ??
        makeBundle(
          makeSession({
            templates: [
              { name: "summary", content: "summary of $@" },
            ],
          }),
        ));

  const host: SessionPromptHost = {
    getBundle: () => currentBundle,
    setStatus: (status, error) => setStatus(status, error),
    isPreparing,
    setPreparing,
    prepareShadowCheckpoint,
    resetTruncationRetries,
  };

  return {
    host,
    setStatus,
    setPreparing,
    prepareShadowCheckpoint,
    resetTruncationRetries,
    /** Replace the bundle mid-flight to simulate dispose → openProject. */
    switchBundle(next: SessionBundle | null) {
      currentBundle = next;
    },
  };
}

describe("runSessionPrompt", () => {
  let ctx: ReturnType<typeof makeHost>;
  beforeEach(() => {
    ctx = makeHost();
  });

  it("rejects when there is no bundle", async () => {
    ctx = makeHost({ bundle: null });
    const result = await runSessionPrompt(ctx.host, { text: "hello" });
    expect(result).toEqual({ ok: false, error: "尚未打开项目" });
    expect(ctx.prepareShadowCheckpoint).not.toHaveBeenCalled();
    expect(ctx.resetTruncationRetries).not.toHaveBeenCalled();
  });

  it("rejects empty text + no images", async () => {
    const result = await runSessionPrompt(ctx.host, {
      text: "   ",
      images: [],
    });
    expect(result).toEqual({ ok: false, error: "消息不能为空" });
    expect(ctx.prepareShadowCheckpoint).not.toHaveBeenCalled();
  });

  it("resets truncation retry counter for user-typed prompt", async () => {
    const result = await runSessionPrompt(ctx.host, { text: "hi" });
    expect(result).toEqual({ ok: true });
    expect(ctx.resetTruncationRetries).toHaveBeenCalledTimes(1);
  });

  it("does NOT reset truncation retry counter for recovery prompt", async () => {
    const text = `${TRUNCATION_RECOVERY_MARKER} recover`;
    const result = await runSessionPrompt(ctx.host, { text });
    expect(result).toEqual({ ok: true });
    expect(ctx.resetTruncationRetries).not.toHaveBeenCalled();
  });

  it("returns silent:true for extension command and forwards raw text to session.prompt", async () => {
    const session = makeSession({
      commands: { custom: { name: "custom" } },
    });
    ctx = makeHost({ bundle: makeBundle(session) });
    const result = await runSessionPrompt(ctx.host, { text: "/custom arg" });
    expect(result).toEqual({ ok: true, silent: true });
    // Extension commands skip the prompt-template wrap (no `<prompt>` chip),
    // but they still go through shadow-prepare like any fresh-turn prompt.
    expect(ctx.prepareShadowCheckpoint).toHaveBeenCalledTimes(1);
    expect(session.prompt).toHaveBeenCalledTimes(1);
    const [sentText, opts] = session.prompt.mock.calls[0]!;
    expect(sentText).toBe("/custom arg");
    expect(opts).toEqual({ images: undefined });
  });

  it("wraps /template via promptTemplates and calls session.prompt", async () => {
    const session = makeSession({
      templates: [
        { name: "summary", content: "summary of $@" },
      ],
    });
    ctx = makeHost({ bundle: makeBundle(session) });
    const result = await runSessionPrompt(ctx.host, {
      text: "/summary foo bar",
    });
    expect(result).toEqual({ ok: true });
    expect(session.prompt).toHaveBeenCalledTimes(1);
    const [sentText, opts] = session.prompt.mock.calls[0]!;
    expect(sentText).toMatch(/^<prompt name="summary"/);
    expect(opts).toEqual({ images: undefined });
  });

  it("steers into active stream without preparing shadow checkpoint", async () => {
    const session = makeSession({ streaming: true });
    ctx = makeHost({ bundle: makeBundle(session) });
    const result = await runSessionPrompt(ctx.host, { text: "follow-up" });
    expect(result).toEqual({ ok: true });
    expect(ctx.prepareShadowCheckpoint).not.toHaveBeenCalled();
    expect(session.prompt).toHaveBeenCalledWith(
      "follow-up",
      expect.objectContaining({ streamingBehavior: "steer" }),
    );
  });

  it("flips promptPreparing true→false around shadow checkpoint", async () => {
    let resolveCheckpoint: (() => void) | undefined;
    ctx.prepareShadowCheckpoint.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveCheckpoint = res;
        }),
    );
    const promise = runSessionPrompt(ctx.host, { text: "first" });
    // Yield once so the prepare branch reaches setPreparing(true).
    await Promise.resolve();
    expect(ctx.setPreparing).toHaveBeenLastCalledWith(true);
    resolveCheckpoint!();
    await promise;
    expect(ctx.setPreparing).toHaveBeenLastCalledWith(false);
  });

  it("returns '会话已切换' when bundle switches during shadow prepare", async () => {
    let resolveCheckpoint: (() => void) | undefined;
    ctx.prepareShadowCheckpoint.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveCheckpoint = res;
        }),
    );
    const promise = runSessionPrompt(ctx.host, { text: "first" });
    await Promise.resolve();
    // Mid-prepare: caller disposed & opened a new bundle.
    ctx.switchBundle(
      makeBundle(makeSession()) as unknown as SessionBundle,
    );
    resolveCheckpoint!();
    const result = await promise;
    expect(result).toEqual({ ok: false, error: "会话已切换" });
  });

  it("maps thrown errors to ok:false + setStatus('error', msg)", async () => {
    const session = makeSession();
    session.prompt.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    ctx = makeHost({ bundle: makeBundle(session) });
    const result = await runSessionPrompt(ctx.host, { text: "trigger" });
    expect(result).toEqual({ ok: false, error: "boom" });
    expect(ctx.setStatus).toHaveBeenCalledWith("error", "boom");
  });
});
