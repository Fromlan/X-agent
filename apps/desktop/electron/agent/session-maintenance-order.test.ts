/** Replay Pi's run/settle boundary through the real host so maintenance cannot race new requests. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentStatus, UiAgentEvent } from "../../shared/ipc";
import type { SessionBundle } from "./session-lifecycle";
import { SessionHost } from "./session-host";
import { patchPrefs, setAgentDirOverrideForTests } from "./prefs";
import { __resetAutoMaintainState } from "./auto-maintain";
import { COMPACTION_FOCUS_INSTRUCTIONS } from "../../shared/agent-instructions";

vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => false } }));

/** Expose only the host seams used to supply an isolated Pi stream and observe event order. */
type HarnessHost = {
  bundle: SessionBundle | null;
  status: AgentStatus;
  bridgeEvents(session: AgentSession): void;
  emit(event: UiAgentEvent): void;
  emitUsageUpdate(): void;
  emitHistoryReplace(): void;
  maybeAutoTitleSession(): Promise<void>;
  setStatus(status: AgentStatus): void;
  shadowCheckpoints: { flush(): Promise<void> };
  sessionMode: { onAgentSettled(): Promise<void> };
};

/** Provide an explicitly released promise to reproduce checkpoint/compact races deterministically. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Build a minimal Pi session while keeping the host, bridge, locks and snip-first pipeline real. */
function fixture(percent = 90) {
  const host = new SessionHost(() => null);
  const seam = host as unknown as HarnessHost;
  const order: string[] = [];
  let listener: (event: unknown) => void = () => undefined;
  const session = {
    sessionId: "maintenance-session",
    isStreaming: false,
    isCompacting: false,
    messages: [{ role: "toolResult", content: [{ type: "text", text: "x".repeat(20_000) }] }],
    sessionManager: { getBranch: () => [], getLeafEntry: () => null },
    getContextUsage: () => ({ tokens: percent * 100, contextWindow: 10_000 }),
    compact: vi.fn(async () => {
      order.push("compact");
      percent = 20;
      return { tokensBefore: 9_000, estimatedTokensAfter: 2_000 };
    }),
    prompt: vi.fn(async () => undefined),
    abort: vi.fn(async () => { session.isStreaming = false; listener({ type: "agent_settled" }); }),
    extensionRunner: { getCommand: () => undefined },
    promptTemplates: [],
    subscribe: (handler: (event: unknown) => void) => {
      listener = handler;
      return () => undefined;
    },
  };
  const bundle = { session, cwd: "D:/isolated-project", sessionPath: null } as unknown as SessionBundle;
  seam.bundle = bundle;
  vi.spyOn(seam, "emit").mockImplementation((event) => {
    if (event.type === "status") order.push(event.status);
  });
  vi.spyOn(seam, "emitUsageUpdate").mockImplementation(() => undefined);
  vi.spyOn(seam, "emitHistoryReplace").mockImplementation(() => undefined);
  vi.spyOn(seam, "maybeAutoTitleSession").mockResolvedValue(undefined);
  const flush = vi.spyOn(seam.shadowCheckpoints, "flush").mockImplementation(async () => { order.push("flush"); });
  const goal = vi.spyOn(seam.sessionMode, "onAgentSettled").mockImplementation(async () => { order.push("goal"); });
  seam.bridgeEvents(session as unknown as AgentSession);
  return {
    host, seam, session, order, flush, goal,
    push: (event: unknown) => listener(event),
    runEnd: () => {
      session.isStreaming = true;
      listener({ type: "agent_start" });
      listener({ type: "turn_start" });
      listener({ type: "turn_end" });
      listener({ type: "agent_end", willRetry: false });
    },
    settle: () => {
      session.isStreaming = false;
      listener({ type: "agent_settled" });
    },
  };
}

describe("checkpoint → maintenance → idle → Goal", () => {
  let directory: string;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "x-agent-maintenance-order-"));
    setAgentDirOverrideForTests(directory);
    __resetAutoMaintainState();
    await patchPrefs({ autoCompactPercent: 80, autoSnipThreshold: 256, autoSnipHeadKeep: 100, autoSnipTailKeep: 50 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setAgentDirOverrideForTests(null);
    __resetAutoMaintainState();
    rmSync(directory, { recursive: true, force: true });
  });

  it("waits for Pi settlement and checkpoints, snips/compacts before idle and Goal", async () => {
    const f = fixture();
    const checkpoint = deferred();
    f.flush.mockImplementation(async () => { f.order.push("flush"); await checkpoint.promise; });
    f.runEnd();
    await Promise.resolve();
    expect(f.seam.status).toBe("streaming");
    expect(f.goal).not.toHaveBeenCalled();
    f.settle();
    expect(f.session.compact).not.toHaveBeenCalled();
    checkpoint.resolve();
    await vi.waitFor(() => expect(f.goal).toHaveBeenCalledTimes(1));
    expect(f.session.messages[0]!.content[0]!.text.length).toBeLessThan(20_000);
    expect(f.order).toEqual(["streaming", "flush", "compact", "idle", "goal"]);
  });

  it("does not maintain below the threshold", async () => {
    const f = fixture(40);
    f.runEnd(); f.settle();
    await vi.waitFor(() => expect(f.goal).toHaveBeenCalledTimes(1));
    expect(f.session.compact).not.toHaveBeenCalled();
    expect(f.session.messages[0]!.content[0]!.text.length).toBe(20_000);
  });

  it("does not advertise idle or continue a Goal at low-level agent_end", async () => {
    const f = fixture();
    f.runEnd();
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.flush).not.toHaveBeenCalled();
    expect(f.seam.status).toBe("streaming");
    expect(f.goal).not.toHaveBeenCalled();
    f.settle();
    await vi.waitFor(() => expect(f.goal).toHaveBeenCalledTimes(1));
  });

  it("does not publish idle from abort before its delayed checkpoint completes", async () => {
    const f = fixture(40);
    const checkpoint = deferred();
    f.flush.mockImplementation(() => checkpoint.promise);
    f.runEnd();
    const abort = f.host.abort();
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.seam.status).toBe("streaming");
    expect((await f.host.prompt({ text: "too early" })).ok).toBe(false);
    checkpoint.resolve();
    expect((await abort).ok).toBe(true);
    expect(f.seam.status).toBe("idle");
    expect((await f.host.prompt({ text: "after abort settlement" })).ok).toBe(true);
  });

  it("keeps every idle publisher behind the settlement guard", async () => {
    const f = fixture(40);
    const checkpoint = deferred();
    f.flush.mockImplementation(() => checkpoint.promise);
    f.runEnd(); f.settle();
    f.seam.setStatus("idle");
    expect(f.seam.status).toBe("streaming");
    checkpoint.resolve();
    await vi.waitFor(() => expect(f.seam.status).toBe("idle"));
  });

  it("skips summary compaction when snipping alone clears the pressure", async () => {
    const f = fixture();
    f.session.getContextUsage = () => ({ tokens: f.session.messages[0]!.content[0]!.text.length > 1_000 ? 9_000 : 2_000, contextWindow: 10_000 });
    f.runEnd(); f.settle();
    await vi.waitFor(() => expect(f.goal).toHaveBeenCalledTimes(1));
    expect(f.session.messages[0]!.content[0]!.text.length).toBeLessThan(1_000);
    expect(f.session.compact).not.toHaveBeenCalled();
  });

  it("blocks fresh prompts and suppresses a duplicate frontend compact while maintenance runs", async () => {
    const f = fixture();
    const compact = deferred();
    f.session.compact.mockImplementation(async () => { f.order.push("compact"); await compact.promise; return { tokensBefore: 9_000, estimatedTokensAfter: 2_000 }; });
    f.runEnd(); f.settle();
    await vi.waitFor(() => expect(f.session.compact).toHaveBeenCalledTimes(1));
    expect((await f.host.prompt({ text: "new request" })).ok).toBe(false);
    expect(f.session.prompt).not.toHaveBeenCalled();
    const frontend = f.host.compactSession();
    compact.resolve();
    await frontend;
    await vi.waitFor(() => expect(f.goal).toHaveBeenCalledTimes(1));
    expect(f.session.compact).toHaveBeenCalledTimes(1);
  });

  it("reserves a manual compact before same-tick requests can queue a second summary", async () => {
    const f = fixture();
    const compact = deferred();
    f.session.compact.mockImplementation(async () => { await compact.promise; return { tokensBefore: 9_000, estimatedTokensAfter: 2_000 }; });
    const first = f.host.compactSession();
    const second = f.host.compactSession();
    expect(f.seam.status).toBe("streaming");
    expect((await second).ok).toBe(false);
    expect((await f.host.prompt({ text: "cannot overtake queued compact" })).ok).toBe(false);
    compact.resolve();
    expect((await first).ok).toBe(true);
    expect(f.seam.status).toBe("idle");
    expect(f.session.compact).toHaveBeenCalledTimes(1);
  });

  it("manual compact preserves user focus after the shared continuation guidance", async () => {
    const f = fixture();
    const focus = "保留 res://levels/main.tscn 的未验证改动与用户的撤销决定";
    expect((await f.host.compactSession(focus)).ok).toBe(true);
    const args: unknown[][] = f.session.compact.mock.calls;
    const instructions = args[0]?.[0];
    expect(typeof instructions).toBe("string");
    expect(instructions).toBe(`${COMPACTION_FOCUS_INSTRUCTIONS}\n\nUser summary instructions:\n${focus}`);
  });

  it.each([undefined, "   \n "])("manual compact without a focus (%j) keeps only shared guidance", async (focus) => {
    const f = fixture();
    expect((await f.host.compactSession(focus)).ok).toBe(true);
    expect(f.session.compact).toHaveBeenCalledExactlyOnceWith(COMPACTION_FOCUS_INSTRUCTIONS);
  });

  it("automatic maintenance uses the same continuation guidance without another summary call", async () => {
    const f = fixture();
    f.runEnd();
    f.settle();
    await vi.waitFor(() => expect(f.goal).toHaveBeenCalledTimes(1));
    expect(f.session.compact).toHaveBeenCalledExactlyOnceWith(COMPACTION_FOCUS_INSTRUCTIONS);
  });

  it("ignores a session switched while checkpoint flush is pending", async () => {
    const f = fixture();
    const checkpoint = deferred();
    f.flush.mockImplementation(() => checkpoint.promise);
    f.runEnd(); f.settle();
    await Promise.resolve();
    f.seam.bundle = null;
    checkpoint.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.session.compact).not.toHaveBeenCalled();
    expect(f.goal).not.toHaveBeenCalled();
  });

  it("ignores a superseded run while its checkpoint flush is pending", async () => {
    const f = fixture();
    const checkpoint = deferred();
    f.flush.mockImplementation(() => checkpoint.promise);
    f.runEnd(); f.settle();
    f.session.isStreaming = true;
    f.push({ type: "agent_start" });
    checkpoint.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.seam.status).toBe("streaming");
    expect(f.goal).not.toHaveBeenCalled();
    expect(f.session.compact).not.toHaveBeenCalled();
  });

  it("does not publish an old maintenance result after the session is replaced", async () => {
    const f = fixture();
    const compact = deferred();
    f.session.compact.mockImplementation(async () => { await compact.promise; return { tokensBefore: 9_000, estimatedTokensAfter: 2_000 }; });
    f.runEnd(); f.settle();
    await vi.waitFor(() => expect(f.session.compact).toHaveBeenCalledTimes(1));
    f.order.length = 0;
    f.seam.bundle = null;
    compact.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.order).not.toContain("idle");
    expect(f.goal).not.toHaveBeenCalled();
  });

  it("does not debounce a new project's maintenance using the previous project's clock", async () => {
    const first = fixture();
    first.runEnd(); first.settle();
    await vi.waitFor(() => expect(first.goal).toHaveBeenCalledTimes(1));
    const second = fixture();
    second.runEnd(); second.settle();
    await vi.waitFor(() => expect(second.goal).toHaveBeenCalledTimes(1));
    expect(first.session.compact).toHaveBeenCalledTimes(1);
    expect(second.session.compact).toHaveBeenCalledTimes(1);
  });

  it("deduplicates settlement and recovers from a failed summary", async () => {
    const f = fixture();
    f.session.compact.mockRejectedValue(new Error("summary failed"));
    f.runEnd(); f.settle(); f.settle();
    await vi.waitFor(() => expect(f.goal).toHaveBeenCalledTimes(1));
    expect(f.session.compact).toHaveBeenCalledTimes(1);
    expect(f.seam.status).toBe("idle");
    expect((await f.host.prompt({ text: "retry after summary failure" })).ok).toBe(true);
  });

  it("keeps checkpoint failures observable and releases the settlement guard", async () => {
    const f = fixture();
    f.flush.mockRejectedValue(new Error("checkpoint unavailable"));
    f.runEnd(); f.settle();
    await vi.waitFor(() => expect(f.seam.status).toBe("error"));
    expect(f.session.compact).not.toHaveBeenCalled();
    expect(f.goal).not.toHaveBeenCalled();
    expect((await f.host.prompt({ text: "retry" })).ok).toBe(true);
  });
});
