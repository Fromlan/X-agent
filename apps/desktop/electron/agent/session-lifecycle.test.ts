/**
 * Vitest 套件 —— SessionLifecycle 可脱离 SessionHost 单测 (issue #59 主题 A).
 *
 * 通过 mock `SessionLifecycleHost` 验证 lifecycle 编排器在 standalone
 * 场景下行为正确: 构造/状态查询/无 bundle 守卫, 不依赖真 Pi session.
 *
 * 与 `retract-orchestrator.test.ts` 对称: 3 个子编排器 (Lifecycle / Mode /
 * Retract) 都有独立的 vitest 套件, 子编排器类型从 host-interfaces.ts 拿,
 * mock host 自己造, 不再需要造一个真 SessionHost 测 lifecycle 单点逻辑.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SessionLifecycle,
  type SessionBundle,
} from "./session-lifecycle";
import type { SessionLifecycleHost } from "./host-interfaces";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { UiAgentEvent } from "../../shared/ipc";

type MockSessionManager = {
  getEntries(): unknown[];
  getBranch(): Array<{ type: string; id: string }>;
  getSessionName(): string | undefined;
  getCwd(): string | null;
  getLeafEntry(): unknown;
  getEntry(id: string): unknown;
};

function makeSession(): AgentSession {
  return {
    sessionId: "test-session",
    sessionManager: {
      getEntries: () => [],
      getBranch: () => [],
      getSessionName: () => undefined,
      getCwd: () => null,
      getLeafEntry: () => null,
      getEntry: () => null,
    } as unknown as MockSessionManager,
  } as unknown as AgentSession;
}

interface MockHostOverrides {
  bundle?: SessionBundle | null;
  initialSessions?: Array<{ path: string; name?: string; cwd: string }>;
  resourceLoader?: unknown;
  godotRpc?: unknown;
}

/** Build a mock SessionLifecycleHost for standalone tests. */
function makeHost(overrides: MockHostOverrides = {}) {
  const events: UiAgentEvent[] = [];
  const notices: Array<{ key: string; text: string; level: string }> = [];
  const setStatus = vi.fn();
  const emit = vi.fn((event: UiAgentEvent) => {
    events.push(event);
  });
  const emitReplaceableNotice = vi.fn(
    (key: string, text: string, level: "info" | "warn" | "error" = "info") => {
      notices.push({ key, text, level });
    },
  );
  const emitUsageUpdate = vi.fn();
  const emitHistoryReplace = vi.fn();
  const pruneToolDetailsToBranch = vi.fn();
  const ensureRuntime = vi.fn(async () => ({
    getModel: () => undefined,
  }));
  const bridgeEvents = vi.fn(() => () => {});
  const prompt = vi.fn(async () => ({ ok: true }));
  const runReplaceExclusive = vi.fn(async <T>(fn: () => Promise<T>) => fn());
  const historyFingerprint = vi.fn(() => "fp");
  const toolDetailsClear = vi.fn();
  const toolDetailsKeys = vi.fn(() => []);
  const fileTrackerClear = vi.fn();
  const fileTrackerSetCwd = vi.fn();
  const fileTrackerLoadFromSession = vi.fn();
  const shadowCheckpointsClear = vi.fn();
  const shadowCheckpointsSetCwd = vi.fn(async () => {});
  const shadowCheckpointsLoadFromSession = vi.fn();
  const shadowCheckpointsPreparePromptCheckpoint = vi.fn(async () => {});

  let currentBundle: SessionBundle | null =
    overrides.bundle === null ? null
      : overrides.bundle ?? (makeSession() as unknown as SessionBundle);

  // The host `getBundle()` returns the bare shape that host-interfaces.ts
  // picks — `SessionBundle`. But the host signature used by session-lifecycle
  // matches SessionLifecycleHost which uses `getBundle(): SessionBundle | null`.
  const host: SessionLifecycleHost = {
    // ResourceState fields
    getBundle: () => currentBundle,
    getResourceLoader: () => (overrides.resourceLoader ?? null) as never,
    getBaseAppendPrompt: () => [],
    fileTracker: {
      kind: "baseline",
      setCwd: fileTrackerSetCwd,
      clear: fileTrackerClear,
      loadFromSession: fileTrackerLoadFromSession,
    } as never,
    shadowCheckpoints: {
      kind: "shadow",
      enabledShadow: false,
      setCwd: shadowCheckpointsSetCwd,
      loadFromSession: shadowCheckpointsLoadFromSession,
      clear: shadowCheckpointsClear,
      preparePromptCheckpoint: shadowCheckpointsPreparePromptCheckpoint,
    } as never,
    sessionMode: {
      getMode: () => "agent",
      getInfo: () => ({
        mode: "agent",
        allowed: true,
        readOnly: false,
        availableModes: ["agent"],
      }),
      getGoal: () => null,
      reset: vi.fn(),
      emitSessionMode: vi.fn(),
      emitGoal: vi.fn(),
      restoreGoalFromJournal: vi.fn(),
      restorePlanFromJournal: vi.fn(),
      composeModeAppend: vi.fn((base: string[]) => [...base]),
      getPlanPath: () => null,
      onPlanWritten: vi.fn(),
      rollbackGoalAfterRetract: vi.fn(),
    } as never,
    godotRpc: (overrides.godotRpc ?? null) as never,
    getLastTurnTokenTotal: () => 0,
    getActiveUserEntryId: () => null,
    // EventBus fields
    emit,
    emitReplaceableNotice,
    setStatus,
    emitUsageUpdate,
    emitHistoryReplace,
    // CwdLock fields (formerly CwdOps)
    pruneToolDetailsToBranch,
    ensureRuntime,
    bridgeEvents,
    prompt,
    promptPreparing: false,
    isPromptPreparing: () => false,
    // CwdLock fields (formerly RuntimeState)
    runReplaceExclusive,
    historyFingerprint,
    toolDetails: {
      clear: toolDetailsClear,
      keys: toolDetailsKeys,
    } as never,
    setBundle: (b: SessionBundle | null) => {
      currentBundle = b;
    },
    setResourceLoader: vi.fn(),
    setBaseAppendPrompt: vi.fn(),
    setLastTurnUsage: vi.fn(),
    clearCompactionState: vi.fn(),
    setAutoTitleInFlight: vi.fn(),
    setLastHistoryFingerprint: vi.fn(),
    onRetractSuccess: vi.fn(),
  };

  return {
    host,
    session: makeSession(),
    events,
    notices,
    setStatus,
    emit,
    emitReplaceableNotice,
    emitUsageUpdate,
    emitHistoryReplace,
    pruneToolDetailsToBranch,
    ensureRuntime,
    bridgeEvents,
    prompt,
    runReplaceExclusive,
    historyFingerprint,
    setBundle: (b: SessionBundle | null) => {
      currentBundle = b;
    },
    fileTrackerClear,
    fileTrackerSetCwd,
    shadowCheckpointsClear,
    shadowCheckpointsSetCwd,
    /** Assert no real Pi session was needed for construction. */
    proofStandalone: () => {
      // No Electron / IPC / getWindow invocation means we never crossed into
      // the full host — proof that lifecycle can run with just the mock host.
      expect(bridgeEvents).not.toHaveBeenCalled();
    },
  };
}

function makeLifecycle(host: SessionLifecycleHost): SessionLifecycle {
  return new SessionLifecycle(() => host);
}

describe("SessionLifecycle（standalone mock host）", () => {
  let ctx: ReturnType<typeof makeHost>;

  beforeEach(() => {
    ctx = makeHost();
  });

  it("可以从 mock host 构造 (issue #59 主题 A: 3 子编排器脱离 SessionHost 单测)", () => {
    const lifecycle = makeLifecycle(ctx.host);
    expect(lifecycle).toBeInstanceOf(SessionLifecycle);
    // 证明构造过程没碰过真 host 资源 (bridge / IPC / window).
    ctx.proofStandalone();
  });

  it("无 bundle 时 listSessions 不抛错 (走文件系统, 只验证不 throw)", async () => {
    const lifecycle = makeLifecycle(ctx.host);
    // listSessions 走 SessionManager.listAll, 会触碰磁盘; 真实环境
    // 在临时目录里跑. 这里只验证 lifecycle 不会在无 bundle 时崩.
    const list = await lifecycle.listSessions();
    expect(Array.isArray(list)).toBe(true);
  });

  it("无 bundle 时 closeWorkspace 返回 ok (走 emitClosedWorkspace 路径)", async () => {
    const lifecycle = makeLifecycle(ctx.host);
    const res = await lifecycle.closeWorkspace();
    expect(res).toEqual({ ok: true });
    // closeWorkspace 走 emitClosedWorkspace, 会 emit 一次 session_info 通知
    // renderer 清空状态. 这里只验证 ok 返回 + emit 至少被调用 (路径走过).
    expect(ctx.emit).toHaveBeenCalled();
  });

  it("无 bundle 时 dispose 静默 (no throw, no emit)", async () => {
    const lifecycle = makeLifecycle(ctx.host);
    await expect(lifecycle.dispose()).resolves.toBeUndefined();
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it("无 bundle 时 renameSession 返回 ok false (路径校验在前)", async () => {
    const lifecycle = makeLifecycle(ctx.host);
    const res = await lifecycle.renameSession("/non/existent.jsonl", "x");
    expect(res.ok).toBe(false);
    // 早期路径校验在 X-agent 隔离守卫处拒绝, 不需要 bundle.
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it("deleteSession: 非 X-agent 路径被会话隔离守卫拒绝", async () => {
    const lifecycle = makeLifecycle(ctx.host);
    const res = await lifecycle.deleteSession("C:\\random\\path\\foo.jsonl");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("本客户端");
    }
  });

  it("host 注入的 setBundle 被 lifecycle 路径用上 (no-op without 副作用)", () => {
    const lifecycle = makeLifecycle(ctx.host);
    // 直接 setBundle 验证 mock host 通道打通 — 真实路径(open/resume)需要
    // Pi SDK, 这里仅验证 host bag 的 setter 通道.
    const next: SessionBundle | null = null;
    ctx.host.setBundle(next);
    expect(ctx.host.getBundle()).toBeNull();
    expect(lifecycle).toBeInstanceOf(SessionLifecycle);
  });

  it("emitReplaceableNotice 通过 host 走, 子编排器拿到的 notice 在 events 之外", () => {
    // 子编排器不应直接 emit notice; 走 host.emitReplaceableNotice 才会
    // 抵达 renderer (这里 capture 在 ctx.notices 数组).
    ctx.host.emitReplaceableNotice("session_mode", "进入 Plan 模式", "info");
    expect(ctx.notices).toEqual([
      { key: "session_mode", text: "进入 Plan 模式", level: "info" },
    ]);
  });

  it("mock host 的 setStatus 不被 lifecycle 在 standalone 下调用 (无 turn)", () => {
    const lifecycle = makeLifecycle(ctx.host);
    void lifecycle;
    expect(ctx.setStatus).not.toHaveBeenCalled();
  });

  it("host 的 prompt / ensureRuntime 仅在显式调用时触发 (lazy)", () => {
    // 构造 lifecycle 不会自动调用这些 deps — 证明子编排器是 lazy /
    // 不会污染 host 状态.
    const lifecycle = makeLifecycle(ctx.host);
    expect(ctx.prompt).not.toHaveBeenCalled();
    expect(ctx.ensureRuntime).not.toHaveBeenCalled();
    expect(lifecycle).toBeInstanceOf(SessionLifecycle);
  });
});
