/** Exercise automatic attachment and cancellation over real TCP with isolated OS and preference adapters. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnection, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PREFS } from "../../shared/ipc";
import { GodotRpcBridge, setGodotRpcEndpointPathForTests } from "./godot-rpc-bridge";
import { GodotConnectionManager, type GodotConnectionDeps } from "./godot-connection-manager";

const cleanups: Array<() => Promise<void>> = [];

/** Wait for an observable lifecycle result without fixed startup sleeps. */
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Connection state did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Build a real bridge with mock editors that answer the same health protocol as the addon. */
async function fixture(auto = false) {
  const root = mkdtempSync(join(tmpdir(), "xagent-connect-test-"));
  setGodotRpcEndpointPathForTests(join(root, "endpoint.json"));
  const bridge = new GodotRpcBridge();
  await bridge.start(0);
  const sockets: Socket[] = [];
  const prefs = structuredClone(DEFAULT_PREFS);
  prefs.godotAutoConnect = auto;
  const attach = async (project: string): Promise<void> => {
    const socket = createConnection({ host: "127.0.0.1", port: bridge.getStatus().port });
    sockets.push(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        const message = JSON.parse(line) as { id: string };
        socket.write(`${JSON.stringify({ id: message.id, ok: true, result: "pong" })}\n`);
      }
    });
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    socket.write(`${JSON.stringify({ type: "editor_ready", projectPath: project, godotVersion: "4.6.2", token: bridge.getAuthToken() })}\n`);
    await waitFor(() => bridge.listClients().some((client) => client.projectPath === project));
  };
  const deps = {
    prefs: () => prefs,
    isProject: (path: string) => !path.includes("ordinary"),
    inspect: vi.fn(() => ({ installed: true, enabled: true, current: true, version: "0.6.4" })),
    install: vi.fn(() => ({ ok: true })),
    running: vi.fn<GodotConnectionDeps["running"]>(async () => []),
    discover: vi.fn<GodotConnectionDeps["discover"]>(async () => ({ engine: { path: "C:/Godot.exe", version: "4.6.2.stable" }, candidates: [] })),
    launch: vi.fn(async (_engine: string, project: string) => { await attach(project); return 42; }),
    isAlive: vi.fn(() => true),
    remember: vi.fn(async () => {}),
    connectTimeoutMs: 30,
    attachGraceMs: 20,
  } satisfies GodotConnectionDeps;
  const manager = new GodotConnectionManager(bridge, deps);
  cleanups.push(async () => {
    manager.dispose();
    for (const socket of sockets) socket.destroy();
    await bridge.stop();
    setGodotRpcEndpointPathForTests(null);
    rmSync(root, { recursive: true, force: true });
  });
  return { bridge, manager, deps, prefs, attach };
}

afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe("GodotConnectionManager", () => {
  it("opening a project automatically launches once and waits for a project health check", async () => {
    const context = await fixture(true);
    const originalTools = [...context.prefs.tools];
    context.bridge.setCurrentCwd("D:/game");
    await waitFor(() => context.manager.getStatus().connection?.phase === "connected");
    expect(context.deps.launch).toHaveBeenCalledOnce();
    expect(context.deps.remember).toHaveBeenCalledWith(expect.any(String), "C:/Godot.exe", expect.any(AbortSignal));
    expect(context.prefs.tools).toEqual(originalTools);
  });

  it("attaches an existing matching editor without an engine path, installation or launch", async () => {
    const context = await fixture();
    await context.attach("D:/game");
    context.bridge.setCurrentCwd("D:/game");
    expect(await context.manager.connect()).toMatchObject({ ok: true });
    expect(context.deps.running).not.toHaveBeenCalled();
    expect(context.deps.discover).not.toHaveBeenCalled();
    expect(context.deps.install).not.toHaveBeenCalled();
    expect(context.deps.launch).not.toHaveBeenCalled();
  });

  it("does not duplicate an authenticated editor when health checks fail and process discovery misses it", async () => {
    const context = await fixture();
    await context.attach("D:/game");
    vi.spyOn(context.bridge, "request").mockImplementation(async (call) => ({ id: call.id, ok: false, error: "simulated ping timeout" }));
    context.bridge.setCurrentCwd("D:/game");
    expect(await context.manager.connect()).toMatchObject({ ok: false });
    expect(context.deps.launch).not.toHaveBeenCalled();
    expect(context.deps.discover).not.toHaveBeenCalled();
    expect(context.manager.getStatus().connection?.phase).toBe("needs_reload");
  });

  it("deduplicates simultaneous connection requests", async () => {
    const context = await fixture();
    context.bridge.setCurrentCwd("D:/game");
    const [first, second] = await Promise.all([context.manager.connect(), context.manager.connect()]);
    expect(first.ok && second.ok).toBe(true);
    expect(context.deps.launch).toHaveBeenCalledOnce();
  });

  it("prepares a missing addon for an open project and requests reload without launching twice", async () => {
    const context = await fixture();
    context.deps.inspect.mockReturnValue({ installed: false, enabled: false, current: false, version: "" });
    context.deps.running.mockResolvedValue([{ pid: 81, executablePath: "C:/Godot.exe", projectPath: "D:/game" }]);
    context.bridge.setCurrentCwd("D:/game");
    expect(await context.manager.connect()).toMatchObject({ ok: false });
    expect(context.manager.getStatus().connection?.phase).toBe("needs_reload");
    expect(context.deps.install).toHaveBeenCalledOnce();
    expect(context.deps.launch).not.toHaveBeenCalled();
  });

  it("late discovery from a previous project cannot install or launch into that project", async () => {
    const context = await fixture(true);
    let release!: (value: []) => void;
    context.deps.running.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    context.bridge.setCurrentCwd("D:/old");
    await waitFor(() => context.deps.running.mock.calls.length === 1);
    context.bridge.setCurrentCwd("D:/new");
    await waitFor(() => context.manager.getStatus().connection?.phase === "connected");
    release([]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(context.deps.launch).toHaveBeenCalledTimes(1);
    expect(context.deps.launch.mock.calls[0]?.[1].replace(/\\/g, "/").toLowerCase()).toBe("d:/new");
    expect(context.manager.getStatus().connection?.projectPath?.replace(/\\/g, "/").toLowerCase()).toBe("d:/new");
  });

  it("retains a launched process after timeout so retry cannot open a duplicate editor", async () => {
    const context = await fixture();
    context.deps.launch.mockResolvedValue(42);
    context.bridge.setCurrentCwd("D:/game");
    expect((await context.manager.connect()).ok).toBe(false);
    expect(context.manager.getStatus().connection?.phase).toBe("error");
    await context.manager.connect();
    expect(context.deps.launch).toHaveBeenCalledOnce();
  });

  it("missing or ambiguous engines yield an actionable state without changing project files", async () => {
    const context = await fixture();
    context.deps.discover.mockResolvedValue({ candidates: [], message: "请选择引擎" });
    context.bridge.setCurrentCwd("D:/game");
    expect(await context.manager.connect()).toMatchObject({ ok: false, error: "请选择引擎" });
    expect(context.manager.getStatus().connection?.phase).toBe("needs_engine");
    expect(context.deps.install).not.toHaveBeenCalled();
    expect(context.deps.launch).not.toHaveBeenCalled();
  });

  it("a preference persistence error does not misreport a healthy editor as disconnected", async () => {
    const context = await fixture();
    context.deps.remember.mockRejectedValue(new Error("locked preferences"));
    context.bridge.setCurrentCwd("D:/game");
    expect(await context.manager.connect()).toMatchObject({ ok: true, hint: expect.stringContaining("未能保存") });
    expect(context.manager.getStatus().connection?.phase).toBe("connected");
  });

  it("auto-connect opt-out and ordinary projects perform no discovery or writes", async () => {
    const context = await fixture();
    context.bridge.setCurrentCwd("D:/game");
    expect(context.manager.getStatus().connection?.phase).toBe("disabled");
    context.bridge.setCurrentCwd("D:/ordinary");
    expect(await context.manager.connect()).toMatchObject({ ok: false });
    expect(context.deps.running).not.toHaveBeenCalled();
    expect(context.deps.install).not.toHaveBeenCalled();
  });

  it("a connection in another project never satisfies the active project's readiness", async () => {
    const context = await fixture();
    await context.attach("D:/other");
    context.bridge.setCurrentCwd("D:/game");
    await context.manager.connect();
    expect(context.deps.launch).toHaveBeenCalledOnce();
    expect(context.manager.getStatus().connection?.phase).toBe("connected");
  });

  it("cancels obsolete discovery after a registry change without launching its removed engine", async () => {
    const context = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    context.deps.discover.mockImplementationOnce(async () => {
      await gate;
      return { engine: { path: "C:/removed.exe", version: "4.7.2.stable" }, candidates: [] };
    });
    context.bridge.setCurrentCwd("D:/game");
    const pending = context.manager.connect();
    await waitFor(() => context.deps.discover.mock.calls.length === 1);
    context.manager.engineSettingsChanged();
    release();
    expect(await pending).toMatchObject({ ok: false });
    expect(context.deps.launch).not.toHaveBeenCalled();
    expect(context.deps.remember).not.toHaveBeenCalled();
    expect(context.manager.getStatus().connection?.phase).toBe("idle");
  });
});
