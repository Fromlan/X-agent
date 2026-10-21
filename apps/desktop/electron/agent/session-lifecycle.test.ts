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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrefsWithRecovery, patchPrefs } from "./prefs";
import {
  SessionLifecycle,
  type SessionBundle,
} from "./session-lifecycle";
import type { SessionLifecycleHost } from "./host-interfaces";
import { SessionManager, parseSessionEntries, type AgentSession, type DefaultResourceLoaderOptions } from "@earendil-works/pi-coding-agent";
import type { UiAgentEvent } from "../../shared/ipc";
import { getXAgentSessionsRoot } from "./session-paths";
import { loadSessionType, saveSessionType } from "./session-type-persistence";
import { SessionModeController } from "./session-mode/controller";

const testHome = vi.hoisted(() => ({ path: "" }));
const initialization = vi.hoisted(() => ({
  failure: "" as "" | "resource" | "model" | "extension",
  mutate: false,
  externalEdit: "",
  options: [] as DefaultResourceLoaderOptions[],
  sessions: [] as AgentSession[],
  sidecarReadFailure: false,
  sidecarSaveFailure: false,
  renameTarget: "",
  renameRelease: null as Promise<void> | null,
  renameExternalEdit: "",
}));

// Exercise failed atomic type persistence without denying unrelated preference writes.
vi.mock("./lib/atomic-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/atomic-write")>();
  return {
    ...actual,
    writeJsonAtomicSync: (path: string, value: unknown) => {
      if (initialization.sidecarSaveFailure && path.endsWith(".session-type.json")) {
        throw Object.assign(new Error("fixture sidecar save denied"), { code: "EACCES" });
      }
      return actual.writeJsonAtomicSync(path, value);
    },
  };
});

// Inject denied sidecar reads only; real SessionManager parsing uses the untouched fs module.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (path: unknown, ...args: unknown[]) => {
      if (initialization.sidecarReadFailure && typeof path === "string" && path.endsWith(".session-type.json")) {
        throw Object.assign(new Error("fixture sidecar permission denied"), { code: "EACCES" });
      }
      return Reflect.apply(actual.readFileSync, actual, [path, ...args]);
    },
    renameSync: (from: unknown, to: unknown) => {
      if (to === initialization.renameTarget) {
        if (!initialization.renameRelease) {
          initialization.renameRelease = new Promise((resolve) => setImmediate(() => {
            if (initialization.renameExternalEdit) actual.writeFileSync(initialization.renameTarget, initialization.renameExternalEdit);
            initialization.renameTarget = "";
            resolve();
          }));
        }
        throw Object.assign(new Error("fixture pending read stream close"), { code: "EPERM" });
      }
      return Reflect.apply(actual.renameSync, actual, [from, to]);
    },
  };
});

// Keep real Pi JSONL parsing while isolating runtime and resource initialization.
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    getAgentDir: () => join(testHome.path, ".pi", "agent"),
    DefaultResourceLoader: class {
      private append: string[] = [];
      /** Capture real lifecycle loader options without loading personal extensions. */
      constructor(private readonly options: DefaultResourceLoaderOptions) { initialization.options.push(options); }
      /** Inject resource failure at the actual reload boundary. */
      async reload() {
        if (initialization.failure === "resource") throw new Error("resource initialization failed");
        this.append = this.options.appendSystemPromptOverride?.(["fixture append"]) ?? [];
      }
      /** Expose the SDK's cached append list for real mode-controller refreshes. */
      getAppendSystemPrompt() { return this.append; }
    },
    createAgentSession: vi.fn(async (options: { sessionManager: SessionManager }) => {
      const manager = options.sessionManager;
      if (initialization.failure === "model") throw new Error("model initialization failed");
      if (initialization.mutate) manager.appendModelChange("fixture", "initialized");
      let activeTools: string[] = [];
      const session = {
        sessionId: manager.getSessionId(),
        sessionFile: manager.getSessionFile(),
        sessionManager: manager,
        thinkingLevel: "off",
        model: undefined,
        isStreaming: false,
        setThinkingLevel: vi.fn(),
        setActiveToolsByName: vi.fn((tools: string[]) => { activeTools = tools; }),
        getActiveToolNames: () => activeTools,
        getSteeringMessages: vi.fn(() => [] as string[]),
        getFollowUpMessages: vi.fn(() => [] as string[]),
        getAvailableThinkingLevels: () => ["off"],
        bindExtensions: vi.fn(async () => {
          if (initialization.externalEdit) writeFileSync(manager.getSessionFile()!, initialization.externalEdit);
          if (initialization.failure === "extension") throw new Error("extension initialization failed");
        }),
        dispose: vi.fn(),
      } as unknown as AgentSession;
      initialization.sessions.push(session);
      return { session };
    }),
  };
});

// A successful lifecycle open must not install anything in the personal Pi home.
vi.mock("./builtin-skills-installer", () => ({ ensureBuiltinDesignSkillsInstalledSafe: vi.fn(async () => {}) }));

// Keep both preference writes and session discovery inside the same disposable home.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => testHome.path || actual.homedir() };
});

type MockSessionManager = {
  getEntries(): unknown[];
  getBranch(): Array<{ type: string; id: string }>;
  getSessionName(): string | undefined;
  getCwd(): string | null;
  getLeafEntry(): unknown;
  getEntry(id: string): unknown;
};

/** Build the minimal inactive session used by lifecycle guard tests. */
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
    getAvailable: async () => [],
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
  let currentLoader = overrides.resourceLoader ?? null;
  let currentAppend: string[] = [];

  // The host `getBundle()` returns the bare shape that host-interfaces.ts
  // picks — `SessionBundle`. But the host signature used by session-lifecycle
  // matches SessionLifecycleHost which uses `getBundle(): SessionBundle | null`.
  const host: SessionLifecycleHost = {
    // ResourceState fields
    getBundle: () => currentBundle,
    getResourceLoader: () => currentLoader as never,
    getBaseAppendPrompt: () => currentAppend,
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
    setResourceLoader: vi.fn((loader) => { currentLoader = loader; }),
    setBaseAppendPrompt: vi.fn((base) => { currentAppend = base; }),
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

/** Exercise the public lifecycle entry points with a controlled host. */
function makeLifecycle(host: SessionLifecycleHost): SessionLifecycle {
  return new SessionLifecycle(() => host);
}

/** Persist a valid Pi conversation in the disposable X-agent session root. */
function createConversation(cwd: string, sessionType: "code" | "design" = "design"): string {
  mkdirSync(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, getXAgentSessionsRoot());
  manager.appendThinkingLevelChange("off");
  manager.appendMessage({ role: "user", content: "fixture conversation", timestamp: Date.now() });
  const sessionPath = manager.getSessionFile()!;
  saveSessionType(sessionPath, sessionType);
  expect(SessionManager.open(sessionPath, getXAgentSessionsRoot()).getBranch()).toHaveLength(2);
  return sessionPath;
}

/** Verify the actual loader and live extension factory retain the restored design policy. */
async function expectDesignPolicy(ctx: ReturnType<typeof makeHost>, sessionPath: string, cwd: string): Promise<void> {
  expect(ctx.host.getBundle()?.sessionType).toBe("design");
  expect(loadSessionType(sessionPath)).toBe("design");
  const loader = initialization.options.at(-1)!;
  const filtered = loader.skillsOverride!({
    skills: ["ordinary", "design-systems"].map((name) => ({
      name, description: name, filePath: join(cwd, ".pi", "skills", name, "SKILL.md"),
      baseDir: cwd, sourceInfo: { path: cwd, source: "local", scope: "project", origin: "top-level" },
      disableModelInvocation: false,
    })),
    diagnostics: [],
  });
  expect(filtered.skills.map((skill) => skill.name)).toEqual(["design-systems", "ordinary"]);
  let handler: ((event: { toolName: string; input: Record<string, unknown> }) => Promise<unknown>) | undefined;
  loader.extensionFactories![1]({
    on: (_name: string, callback: typeof handler) => { handler = callback; },
  } as never);
  expect(handler).toBeDefined();
  expect(await handler!({ toolName: "write", input: { path: "scripts/player.gd", content: "blocked" } })).toMatchObject({ block: true });
  expect(await handler!({ toolName: "write", input: { path: "game-design/design.md", content: "allowed" } })).toBeUndefined();
}

describe("SessionLifecycle（standalone mock host）", () => {
  let ctx: ReturnType<typeof makeHost>;

  beforeEach(() => {
    testHome.path = mkdtempSync(join(tmpdir(), "x-agent-lifecycle-home-"));
    loadPrefsWithRecovery();
    ctx = makeHost();
    initialization.failure = "";
    initialization.mutate = false;
    initialization.externalEdit = "";
    initialization.options = [];
    initialization.sessions = [];
    initialization.sidecarReadFailure = false;
    initialization.sidecarSaveFailure = false;
    initialization.renameTarget = "";
    initialization.renameRelease = null;
    initialization.renameExternalEdit = "";
  });

  afterEach(async () => {
    await initialization.renameRelease;
    // Drain lifecycle's queued preference updates before removing their directory.
    await patchPrefs({});
    rmSync(testHome.path, { recursive: true, force: true });
    testHome.path = "";
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
    expect(list).toEqual([]);
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

  it.each(["resume", "continue", "fallback"] as const)("%s restores design type, sidecar, skill priority and write boundary", async (entry) => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const sessionPath = createConversation(cwd);
    const typeBytes = readFileSync(`${sessionPath}.session-type.json`);
    const lifecycle = makeLifecycle(ctx.host);
    if (entry === "resume") {
      expect((await lifecycle.resumeSession(sessionPath)).ok).toBe(true);
    } else if (entry === "continue") {
      expect((await lifecycle.openProject(cwd, "continue", "code")).ok).toBe(true);
    } else {
      const doomed = createConversation(cwd, "code");
      expect((await lifecycle.resumeSession(doomed)).ok).toBe(true);
      expect((await lifecycle.deleteSession(doomed)).ok).toBe(true);
      expect(ctx.host.getBundle()?.sessionPath).toBe(sessionPath);
      expect(existsSync(doomed)).toBe(false);
    }
    await expectDesignPolicy(ctx, sessionPath, cwd);
    expect(readFileSync(`${sessionPath}.session-type.json`)).toEqual(typeBytes);
  });

  it("only a newly created session uses the requested type; legacy conversations remain code", async () => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const sessionPath = createConversation(cwd, "code");
    rmSync(`${sessionPath}.session-type.json`);
    const lifecycle = makeLifecycle(ctx.host);
    expect((await lifecycle.openProject(cwd, "continue", "design")).ok).toBe(true);
    expect(ctx.host.getBundle()?.sessionType).toBe("code");
    expect((await lifecycle.newSession("design")).ok).toBe(true);
    expect(ctx.host.getBundle()?.sessionType).toBe("design");
    expect(loadSessionType(ctx.host.getBundle()!.sessionPath!)).toBe("design");
  });

  it.each(["resource", "model", "extension"] as const)("keeps valid JSONL bytes and allows retry after %s initialization failure", async (failure) => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const sessionPath = createConversation(cwd);
    const before = readFileSync(sessionPath);
    const lifecycle = makeLifecycle(ctx.host);
    initialization.failure = failure;
    initialization.mutate = failure === "extension";
    const result = await lifecycle.resumeSession(sessionPath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(`${failure} initialization failed`);
    expect(existsSync(sessionPath)).toBe(true);
    expect(readFileSync(sessionPath)).toEqual(before);
    expect(readdirSync(getXAgentSessionsRoot()).some((file) => file.includes(".broken-"))).toBe(false);
    if (failure === "extension") expect(initialization.sessions.at(-1)!.dispose).toHaveBeenCalledOnce();
    initialization.failure = "";
    initialization.mutate = false;
    expect((await lifecycle.resumeSession(sessionPath)).ok).toBe(true);
    await expectDesignPolicy(ctx, sessionPath, cwd);
  });

  it("does not replace an external edit when initialization fails", async () => {
    ctx = makeHost({ bundle: null });
    const sessionPath = createConversation(join(testHome.path, "project"));
    initialization.failure = "extension";
    initialization.mutate = true;
    initialization.externalEdit = readFileSync(sessionPath, "utf8") + "external edit\n";
    const result = await makeLifecycle(ctx.host).resumeSession(sessionPath);
    expect(result.ok).toBe(false);
    expect(readFileSync(sessionPath, "utf8")).toBe(initialization.externalEdit);
  });

  it.each(["plan", "goal"] as const)("failed initialization preserves the active %s controller, bundle and design policy", async (mode) => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const activePath = createConversation(cwd);
    const lifecycle = makeLifecycle(ctx.host);
    expect((await lifecycle.resumeSession(activePath)).ok).toBe(true);
    ctx.host.sessionMode = new SessionModeController(() => ctx.host);
    ctx.host.sessionMode.setAgentMode(mode);
    ctx.host.sessionMode.setPlanPath(join(cwd, "plan.md"));
    const goal = { condition: "preserve fixture goal", status: "paused" as const };
    ctx.host.sessionMode.setGoalState(goal as never);
    const active = ctx.host.getBundle();
    const oldLoader = ctx.host.getResourceLoader();
    const oldAppend = ctx.host.getBaseAppendPrompt();
    const targetPath = createConversation(cwd, "code");
    initialization.failure = "extension";
    const result = await lifecycle.resumeSession(targetPath);
    expect(result.ok).toBe(false);
    expect(ctx.host.getBundle()).toBe(active);
    expect(ctx.host.getResourceLoader()).toBe(oldLoader);
    expect(ctx.host.getBaseAppendPrompt()).toBe(oldAppend);
    expect(ctx.host.sessionMode.getMode()).toBe(mode);
    expect(ctx.host.sessionMode.getPlanPath()).toBe(join(cwd, "plan.md"));
    expect(ctx.host.sessionMode.getGoal()).toBe(goal);
    expect(active!.session.dispose).not.toHaveBeenCalled();
    // The old loader's policy is still design, even though the failed candidate was code.
    initialization.options.pop();
    await expectDesignPolicy(ctx, activePath, cwd);
  });

  it("preserves valid JSONL on a session-parser I/O failure", async () => {
    ctx = makeHost({ bundle: null });
    const sessionPath = createConversation(join(testHome.path, "project"));
    const original = readFileSync(sessionPath);
    const open = vi.spyOn(SessionManager, "open").mockImplementationOnce(() => {
      throw Object.assign(new Error("EACCES: fixture permission denied"), { code: "EACCES" });
    });
    try {
      const result = await makeLifecycle(ctx.host).resumeSession(sessionPath);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("permission denied");
      expect(readFileSync(sessionPath)).toEqual(original);
    } finally { open.mockRestore(); }
  });

  it.each([1, 2])("restores valid legacy v%s JSONL bytes when initialization fails after Pi's migration", async (version) => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const sessionPath = createConversation(cwd);
    const entries = parseSessionEntries(readFileSync(sessionPath, "utf8"));
    const header = entries.find((entry) => entry.type === "session")!;
    header.version = version;
    writeFileSync(sessionPath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const original = readFileSync(sessionPath);
    // Pi confirms validity in memory so this proof does not migrate the file first.
    expect(SessionManager.inMemory(cwd, undefined, parseSessionEntries(original.toString())).getBranch()).toHaveLength(2);
    const lifecycle = makeLifecycle(ctx.host);
    initialization.failure = "resource";
    expect((await lifecycle.resumeSession(sessionPath)).ok).toBe(false);
    expect(readFileSync(sessionPath)).toEqual(original);
    initialization.failure = "";
    expect((await lifecycle.resumeSession(sessionPath)).ok).toBe(true);
    expect(SessionManager.open(sessionPath).getHeader()!.version).toBe(3);
  });

  it("prepares a new design append without inheriting the previous Plan mode", async () => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const sessionPath = createConversation(cwd, "code");
    const lifecycle = makeLifecycle(ctx.host);
    expect((await lifecycle.resumeSession(sessionPath)).ok).toBe(true);
    ctx.host.sessionMode = new SessionModeController(() => ctx.host);
    ctx.host.sessionMode.setAgentMode("plan");
    expect((await lifecycle.newSession("design")).ok).toBe(true);
    const append = ctx.host.getResourceLoader()!.getAppendSystemPrompt().join("\n");
    expect(append).toContain("Design session");
    expect(append).not.toContain("# X-agent Plan mode");
    expect(ctx.host.sessionMode.getMode()).toBe("agent");
  });

  it.each(["{ invalid", "[]", '{"version":99,"sessionType":"design"}', '{"version":1,"sessionType":"invalid"}'])("rejects an existing unsafe sidecar without changing valid JSONL: %s", async (record) => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const sessionPath = createConversation(cwd);
    const entries = parseSessionEntries(readFileSync(sessionPath, "utf8"));
    entries.find((entry) => entry.type === "session")!.version = 2;
    writeFileSync(sessionPath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    writeFileSync(`${sessionPath}.session-type.json`, record);
    const original = readFileSync(sessionPath);
    const lifecycle = makeLifecycle(ctx.host);
    const result = await lifecycle.resumeSession(sessionPath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("会话类型");
    expect(ctx.host.getBundle()).toBeNull();
    expect(readFileSync(sessionPath)).toEqual(original);
    expect(readFileSync(`${sessionPath}.session-type.json`, "utf8")).toBe(record);
    expect(initialization.options).toHaveLength(0);
    saveSessionType(sessionPath, "design");
    expect((await lifecycle.resumeSession(sessionPath)).ok).toBe(true);
    await expectDesignPolicy(ctx, sessionPath, cwd);
  });

  it("denied sidecar reads reject every existing-session entry without granting code permissions", async () => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const sessionPath = createConversation(cwd);
    const before = readFileSync(sessionPath);
    const lifecycle = makeLifecycle(ctx.host);
    initialization.sidecarReadFailure = true;
    for (const entry of [() => lifecycle.resumeSession(sessionPath), () => lifecycle.openProject(cwd, "continue", "code")]) {
      const result = await entry();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("EACCES");
      expect(ctx.host.getBundle()).toBeNull();
      expect(readFileSync(sessionPath)).toEqual(before);
    }
    initialization.sidecarReadFailure = false;
    expect(loadSessionType(sessionPath)).toBe("design");
    expect((await lifecycle.resumeSession(sessionPath)).ok).toBe(true);
  });

  it("a broken type record does not hide unrelated healthy sessions", async () => {
    const cwd = join(testHome.path, "project");
    const broken = createConversation(cwd);
    const healthy = createConversation(cwd);
    writeFileSync(`${broken}.session-type.json`, "invalid record");
    const sessions = await makeLifecycle(ctx.host).listSessions();
    expect(sessions.map((session) => session.path)).toEqual([healthy]);
    expect(ctx.notices.some((notice) => notice.text.includes("会话类型"))).toBe(true);
    expect(readFileSync(`${broken}.session-type.json`, "utf8")).toBe("invalid record");
  });

  it("failed new-design type persistence preserves the old bundle and allows a safe retry", async () => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const sessionPath = createConversation(cwd);
    const lifecycle = makeLifecycle(ctx.host);
    expect((await lifecycle.resumeSession(sessionPath)).ok).toBe(true);
    ctx.host.sessionMode = new SessionModeController(() => ctx.host);
    ctx.host.sessionMode.setAgentMode("plan");
    const oldBundle = ctx.host.getBundle();
    const sidecar = readFileSync(`${sessionPath}.session-type.json`);
    initialization.sidecarSaveFailure = true;
    const result = await lifecycle.newSession("design");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("会话类型");
    expect(ctx.host.getBundle()).toBe(oldBundle);
    expect(ctx.host.sessionMode.getMode()).toBe("plan");
    expect(readFileSync(`${sessionPath}.session-type.json`)).toEqual(sidecar);
    expect(initialization.sessions.at(-1)!.dispose).toHaveBeenCalledOnce();
    initialization.sidecarSaveFailure = false;
    expect((await lifecycle.newSession("design")).ok).toBe(true);
    const newPath = ctx.host.getBundle()!.sessionPath!;
    expect(loadSessionType(newPath)).toBe("design");
    // Persist a real user entry before exercising the resumed-session policy.
    ctx.host.getBundle()!.session.sessionManager.appendMessage({ role: "user", content: "new design fixture", timestamp: Date.now() });
    expect((await lifecycle.resumeSession(newPath)).ok).toBe(true);
    await expectDesignPolicy(ctx, newPath, cwd);
  });

  it.each([1, 2])("project reopening preserves valid legacy v%s bytes on runtime failure", async (version) => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const path = createConversation(cwd);
    const entries = parseSessionEntries(readFileSync(path, "utf8"));
    entries.find((entry) => entry.type === "session")!.version = version;
    writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const original = readFileSync(path);
    expect(SessionManager.inMemory(cwd, undefined, parseSessionEntries(original.toString())).getBranch()).toHaveLength(2);
    initialization.failure = "extension";
    const lifecycle = makeLifecycle(ctx.host);
    expect((await lifecycle.openProject(cwd, "continue", "code")).ok).toBe(false);
    expect(readFileSync(path)).toEqual(original);
    initialization.failure = "";
    expect((await lifecycle.openProject(cwd, "continue", "code")).ok).toBe(true);
    await expectDesignPolicy(ctx, path, cwd);
  });

  it("project reopening keeps SDK recent selection when message activity and file modification differ", async () => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const olderMessages = createConversation(cwd);
    const newerMessages = createConversation(cwd, "code");
    utimesSync(newerMessages, new Date(1_000), new Date(1_000));
    utimesSync(olderMessages, new Date(2_000), new Date(2_000));
    const sdkSelected = SessionManager.continueRecent(cwd, getXAgentSessionsRoot()).getSessionFile();
    expect(sdkSelected).toBe(olderMessages);
    const result = await makeLifecycle(ctx.host).openProject(cwd, "continue", "code");
    expect(result.ok).toBe(true);
    expect(ctx.host.getBundle()?.sessionPath).toBe(sdkSelected);
    await expectDesignPolicy(ctx, olderMessages, cwd);
  });

  it.each([
    { version: 1, failure: "model" as const },
    { version: 1, failure: "resource" as const },
    { version: 2, failure: "model" as const },
    { version: 2, failure: "resource" as const },
  ])("failed delete fallback preserves legacy v$version JSONL after $failure initialization", async ({ version, failure }) => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const fallback = createConversation(cwd);
    const entries = parseSessionEntries(readFileSync(fallback, "utf8"));
    entries.find((entry) => entry.type === "session")!.version = version;
    writeFileSync(fallback, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const original = readFileSync(fallback);
    const sidecar = readFileSync(`${fallback}.session-type.json`);
    expect(SessionManager.inMemory(cwd, undefined, parseSessionEntries(original.toString())).getBranch()).toHaveLength(2);
    const doomedPath = createConversation(cwd, "code");
    const lifecycle = makeLifecycle(ctx.host);
    expect((await lifecycle.resumeSession(doomedPath)).ok).toBe(true);
    const doomed = ctx.host.getBundle()!;
    initialization.failure = failure;
    expect(await lifecycle.deleteSession(doomedPath)).toEqual({ ok: true });
    expect(existsSync(doomedPath)).toBe(false);
    expect(doomed.session.dispose).toHaveBeenCalledOnce();
    expect(ctx.host.getBundle()).toBeNull();
    expect(ctx.host.getResourceLoader()).toBeNull();
    expect(readFileSync(fallback)).toEqual(original);
    expect(readFileSync(`${fallback}.session-type.json`)).toEqual(sidecar);
    expect(readdirSync(getXAgentSessionsRoot()).some((file) => file.includes(".broken-"))).toBe(false);
    expect(ctx.notices.some((notice) => notice.level === "warn" && notice.text.includes(`${failure} initialization failed`))).toBe(true);
    expect(ctx.events.filter((event) => event.type === "session_info").at(-1)).toMatchObject({ sessionId: "", cwd: "", sessionPath: null });
    expect(ctx.events.filter((event) => event.type === "history_replace").at(-1)).toEqual({ type: "history_replace", items: [] });
    initialization.failure = "";
    expect((await lifecycle.resumeSession(fallback)).ok).toBe(true);
    await expectDesignPolicy(ctx, fallback, cwd);
  });

  it.each([false, true])("failed fallback waits for a pending stream close and preserves external edits: %s", async (externalEdit) => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const fallback = createConversation(cwd);
    const entries = parseSessionEntries(readFileSync(fallback, "utf8"));
    entries.find((entry) => entry.type === "session")!.version = 2;
    writeFileSync(fallback, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const original = readFileSync(fallback);
    const sidecar = readFileSync(`${fallback}.session-type.json`);
    const doomedPath = createConversation(cwd, "code");
    const lifecycle = makeLifecycle(ctx.host);
    expect((await lifecycle.resumeSession(doomedPath)).ok).toBe(true);
    initialization.failure = "model";
    initialization.renameTarget = fallback;
    initialization.renameExternalEdit = externalEdit ? original.toString() + "external edit\n" : "";
    expect(await lifecycle.deleteSession(doomedPath)).toEqual({ ok: true });
    await initialization.renameRelease;
    expect(initialization.renameRelease).not.toBeNull();
    expect(readFileSync(fallback)).toEqual(externalEdit ? Buffer.from(initialization.renameExternalEdit) : original);
    expect(readFileSync(`${fallback}.session-type.json`)).toEqual(sidecar);
    expect(ctx.host.getBundle()).toBeNull();
    expect(readdirSync(getXAgentSessionsRoot()).some((file) => file.endsWith(".tmp"))).toBe(false);
    expect(ctx.notices.some((notice) => notice.text.includes("已保留当前文件"))).toBe(externalEdit);
    expect(ctx.notices.some((notice) => notice.text.includes("恢复会话初始化前内容失败"))).toBe(false);
  });

  it("delete fallback checkpoint failure closes a published candidate instead of keeping a hidden live bundle", async () => {
    ctx = makeHost({ bundle: null });
    const cwd = join(testHome.path, "project");
    const fallback = createConversation(cwd);
    const doomedPath = createConversation(cwd, "code");
    const lifecycle = makeLifecycle(ctx.host);
    expect((await lifecycle.resumeSession(doomedPath)).ok).toBe(true);
    const doomed = ctx.host.getBundle()!;
    ctx.shadowCheckpointsSetCwd.mockRejectedValueOnce(new Error("checkpoint setup failed"));
    expect(await lifecycle.deleteSession(doomedPath)).toEqual({ ok: true });
    expect(ctx.host.getBundle()).toBeNull();
    expect(ctx.host.getResourceLoader()).toBeNull();
    expect(doomed.session.dispose).toHaveBeenCalledOnce();
    expect(initialization.sessions.at(-1)!.dispose).toHaveBeenCalledOnce();
    expect(existsSync(fallback)).toBe(true);
    expect(loadSessionType(fallback)).toBe("design");
    expect(ctx.notices.some((notice) => notice.level === "warn" && notice.text.includes("checkpoint setup failed"))).toBe(true);
    expect(readdirSync(getXAgentSessionsRoot()).some((file) => file.includes(".broken-"))).toBe(false);
    expect(ctx.events.filter((event) => event.type === "session_info").at(-1)).toMatchObject({ sessionId: "", cwd: "", sessionPath: null });
  });

  it("post-publication checkpoint failure announces the actual new bundle type and history", async () => {
    ctx = makeHost({ bundle: null });
    const lifecycle = makeLifecycle(ctx.host);
    const oldPath = createConversation(join(testHome.path, "old-project"), "code");
    expect((await lifecycle.resumeSession(oldPath)).ok).toBe(true);
    const old = ctx.host.getBundle()!;
    const targetCwd = join(testHome.path, "target-project");
    const targetPath = createConversation(targetCwd);
    SessionManager.open(targetPath).appendMessage({ role: "user", content: "published target history", timestamp: Date.now() });
    ctx.shadowCheckpointsSetCwd.mockRejectedValueOnce(new Error("checkpoint setup failed"));
    const result = await lifecycle.resumeSession(targetPath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("checkpoint setup failed");
    expect(ctx.host.getBundle()?.sessionPath).toBe(targetPath);
    expect(ctx.host.getBundle()?.sessionType).toBe("design");
    expect(old.session.dispose).toHaveBeenCalledOnce();
    const info = ctx.events.filter((event) => event.type === "session_info").at(-1);
    expect(info).toMatchObject({ type: "session_info", sessionId: ctx.host.getBundle()!.session.sessionId, cwd: targetCwd, sessionType: "design" });
    const history = ctx.events.filter((event) => event.type === "history_replace").at(-1);
    expect(JSON.stringify(history)).toContain("published target history");
    expect(initialization.sessions.at(-1)!.dispose).not.toHaveBeenCalled();
  });

  it("same-ID restore checkpoint failure publishes the new runtime's actual queues", async () => {
    ctx = makeHost({ bundle: null });
    const lifecycle = makeLifecycle(ctx.host);
    const path = createConversation(join(testHome.path, "project"));
    expect((await lifecycle.resumeSession(path)).ok).toBe(true);
    const old = ctx.host.getBundle()!;
    vi.mocked(old.session.getSteeringMessages).mockReturnValue(["old queued steer"]);
    vi.mocked(old.session.getFollowUpMessages).mockReturnValue(["old queued follow-up"]);
    ctx.shadowCheckpointsSetCwd.mockRejectedValueOnce(new Error("checkpoint setup failed"));
    const result = await lifecycle.resumeSession(path);
    expect(result.ok).toBe(false);
    const current = ctx.host.getBundle()!;
    expect(current.session.sessionId).toBe(old.session.sessionId);
    expect(current.session).not.toBe(old.session);
    expect(old.session.dispose).toHaveBeenCalledOnce();
    expect(current.session.dispose).not.toHaveBeenCalled();
    const queue = ctx.events.filter((event) => event.type === "queue_update").at(-1);
    expect(queue).toEqual({ type: "queue_update", steering: [], followUp: [] });
    expect(current.session.getSteeringMessages).toHaveBeenCalledOnce();
    expect(current.session.getFollowUpMessages).toHaveBeenCalledOnce();
  });

  it("backs up confirmed unparsable JSONL at the parsing boundary", async () => {
    ctx = makeHost({ bundle: null });
    const sessionPath = join(getXAgentSessionsRoot(), "broken.jsonl");
    writeFileSync(sessionPath, "invalid JSONL bytes");
    const result = await makeLifecycle(ctx.host).resumeSession(sessionPath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("会话文件无法解析");
    expect(existsSync(sessionPath)).toBe(false);
    const backup = readdirSync(getXAgentSessionsRoot()).find((file) => file.includes("broken.jsonl.broken-"))!;
    expect(readFileSync(join(getXAgentSessionsRoot(), backup), "utf8")).toBe("invalid JSONL bytes");
  });
});
