/** Reproduce runtime initialization races without personal credentials or model requests. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, type AgentSession } from "@earendil-works/pi-coding-agent";
import { SessionHost } from "./session-host";
import type { SessionBundle } from "./session-lifecycle";
import { setAgentDirOverrideForTests } from "./prefs";
import { withStoreLock } from "./lib/store-mutex";

vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => false } }));

type RuntimeSeam = {
  bundle: SessionBundle | null;
  modelRuntime: ModelRuntime | null;
  sessionConfigDeps(): { ensureRuntime(): Promise<ModelRuntime> };
  emitUsageUpdate(): void;
};

/** Hold a factory result at a deterministic await boundary, including rejection tests. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

/** Flush only ready microtasks; the repair helpers return immediately for absent models.json. */
async function nextEventLoopTurn(): Promise<void> {
  await new Promise<void>((done) => setImmediate(done));
}

/** Register the same provider shape as the Electron fixture on a real SDK runtime. */
function registerFixture(runtime: ModelRuntime): void {
  runtime.registerProvider("ui-fixture", {
    baseUrl: "https://offline.example", apiKey: "placeholder", api: "openai-completions",
    models: [{
      id: "fixture", name: "UI fixture", reasoning: false, input: ["text"],
      contextWindow: 200_000, maxTokens: 1_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
  });
}

/** Supply the inactive session adapter while keeping host lookup and model configuration real. */
function attachSession(host: SessionHost): void {
  const session = {
    sessionId: "runtime-fixture", model: undefined, thinkingLevel: "off",
    setModel: vi.fn(async () => undefined), getAvailableThinkingLevels: () => ["off"],
  } as unknown as AgentSession;
  const seam = host as unknown as RuntimeSeam;
  seam.bundle = { session, cwd: "D:/isolated-project", sessionPath: null } as SessionBundle;
  vi.spyOn(seam, "emitUsageUpdate").mockImplementation(() => undefined);
}

describe("SessionHost runtime initialization", () => {
  let directory: string;
  let runtimeA: ModelRuntime;
  let runtimeB: ModelRuntime;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "x-agent-runtime-init-"));
    setAgentDirOverrideForTests(directory);
    vi.stubEnv("PI_OFFLINE", "1");
    // Separate real SDK stores keep the controlled factory results independent.
    const create = ModelRuntime.create.bind(ModelRuntime);
    /** Build a real SDK runtime with explicit stores and network refresh disabled. */
    const makeRuntime = async (label: string) => {
      const path = join(directory, label);
      mkdirSync(path);
      return create({
        authPath: join(path, "auth.json"), modelsPath: join(path, "models.json"),
        allowModelNetwork: false, refreshOnCreate: false,
      });
    };
    runtimeA = await makeRuntime("runtime-a");
    runtimeB = await makeRuntime("runtime-b");
  });

  afterEach(async () => {
    // Successful setModel writes preferences asynchronously; drain before removing the profile.
    await withStoreLock(join(directory, "x-agent.json"), async () => undefined);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setAgentDirOverrideForTests(null);
    rmSync(directory, { recursive: true, force: true });
  });

  it("shares lifecycle and bootstrap initialization so a late factory cannot lose project models", async () => {
    const host = new SessionHost(() => null);
    const seam = host as unknown as RuntimeSeam;
    const first = deferred<ModelRuntime>();
    const late = deferred<ModelRuntime>();
    const started = deferred<void>();
    const create = vi.spyOn(ModelRuntime, "create")
      .mockImplementationOnce(() => { started.resolve(); return first.promise; })
      .mockImplementationOnce(() => late.promise);
    // Lifecycle and bootstrap use the same real host ensureRuntime closure.
    const lifecycle = seam.sessionConfigDeps().ensureRuntime();
    await started.promise;
    const bootstrap = host.listModels();
    try {
      await nextEventLoopTurn();
      first.resolve(runtimeA);
      const projectRuntime = await lifecycle;
      registerFixture(projectRuntime);
      attachSession(host);
      expect(projectRuntime.getModel("ui-fixture", "fixture")).toBeDefined();
      // Old code replaces A with B after successful project initialization.
      late.resolve(runtimeB);
      await bootstrap;
      expect(await host.setModel("ui-fixture", "fixture")).toEqual({ ok: true });
      expect(seam.modelRuntime).toBe(projectRuntime);
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      first.resolve(runtimeA); late.resolve(runtimeB);
      await Promise.allSettled([lifecycle, bootstrap]);
    }
  });

  it("reports a shared initialization failure to every caller and permits a fresh retry", async () => {
    const host = new SessionHost(() => null);
    const seam = host as unknown as RuntimeSeam;
    const first = deferred<ModelRuntime>();
    const started = deferred<void>();
    const failure = new Error("isolated runtime initialization failed");
    const create = vi.spyOn(ModelRuntime, "create")
      .mockImplementationOnce(() => { started.resolve(); return first.promise; })
      .mockResolvedValue(runtimeA);
    const bootstrap = host.listModels();
    await started.promise;
    const lifecycle = seam.sessionConfigDeps().ensureRuntime();
    const settled = Promise.allSettled([bootstrap, lifecycle]);
    await nextEventLoopTurn();
    first.reject(failure);
    const outcomes = await settled;
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") expect(outcome.reason).toBe(failure);
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(await seam.sessionConfigDeps().ensureRuntime()).toBe(runtimeA);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("waits for pending initialization before a hard reload creates its replacement", async () => {
    const host = new SessionHost(() => null);
    const seam = host as unknown as RuntimeSeam;
    const initial = deferred<ModelRuntime>();
    const replacement = deferred<ModelRuntime>();
    const started = deferred<void>();
    const create = vi.spyOn(ModelRuntime, "create")
      .mockImplementationOnce(() => { started.resolve(); return initial.promise; })
      .mockImplementationOnce(() => replacement.promise);
    const lifecycle = seam.sessionConfigDeps().ensureRuntime();
    await started.promise;
    const reload = host.reloadRuntime({ hard: true });
    try {
      await nextEventLoopTurn();
      expect(create).toHaveBeenCalledTimes(1);
      initial.resolve(runtimeA);
      expect(await lifecycle).toBe(runtimeA);
      await nextEventLoopTurn();
      expect(create).toHaveBeenCalledTimes(2);
      replacement.resolve(runtimeB);
      await reload;
      expect(await seam.sessionConfigDeps().ensureRuntime()).toBe(runtimeB);
    } finally {
      initial.resolve(runtimeA); replacement.resolve(runtimeB);
      await Promise.allSettled([lifecycle, reload]);
    }
  });

  it("waits for pending initialization before a soft reload refreshes the shared runtime", async () => {
    const host = new SessionHost(() => null);
    const seam = host as unknown as RuntimeSeam;
    const initial = deferred<ModelRuntime>();
    const started = deferred<void>();
    const refresh = vi.spyOn(runtimeA, "refresh").mockResolvedValue(undefined);
    const create = vi.spyOn(ModelRuntime, "create")
      .mockImplementationOnce(() => { started.resolve(); return initial.promise; })
      .mockResolvedValue(runtimeB);
    const lifecycle = seam.sessionConfigDeps().ensureRuntime();
    await started.promise;
    const reload = host.reloadRuntime();
    try {
      await nextEventLoopTurn();
      expect(create).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
      initial.resolve(runtimeA);
      await Promise.all([lifecycle, reload]);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(await seam.sessionConfigDeps().ensureRuntime()).toBe(runtimeA);
    } finally {
      initial.resolve(runtimeA);
      await Promise.allSettled([lifecycle, reload]);
    }
  });
});
