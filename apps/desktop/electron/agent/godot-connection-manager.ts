/** Coordinate project attachment, addon preparation and editor startup independently of model tools. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ClientPrefs } from "../../shared/ipc";
import type { GodotConnectionStatus } from "../../shared/godot-connection";
import { projectGodotClients } from "../../shared/godot-connection";
import { normalizeProjectKey } from "../../shared/project-path";
import { godotEngineName } from "../../shared/godot-engines";
import type { GodotRpcBridgeStatus } from "../../shared/godot-rpc";
import { GodotRpcBridge } from "./godot-rpc-bridge";
import { inspectGodotRpcAddon, installGodotRpcAddon } from "./godot-addon-install";
import { discoverGodotEngine, listRunningGodotEditors, probeGodotEngine, type GodotEngineDiscovery, type RunningGodotEditor } from "./godot-engine-discovery";
import { getCachedPrefs, registerGodotEngine } from "./prefs";

export interface GodotConnectionDeps {
  prefs: () => ClientPrefs;
  isProject: (path: string) => boolean;
  inspect: typeof inspectGodotRpcAddon;
  install: typeof installGodotRpcAddon;
  running: (signal?: AbortSignal) => Promise<RunningGodotEditor[]>;
  discover: (project: string, prefs: ClientPrefs, running: RunningGodotEditor[], signal?: AbortSignal) => Promise<GodotEngineDiscovery>;
  launch: (engine: string, project: string) => Promise<number>;
  isAlive: (pid: number) => boolean;
  remember: (project: string, engine: string, signal: AbortSignal) => Promise<void>;
  connectTimeoutMs?: number;
  attachGraceMs?: number;
}

export type GodotConnectResult = { ok: boolean; error?: string; hint?: string; port?: number };

/** Launch a visible editor with argument arrays and detach only after Windows accepts the process. */
function launchEditor(engine: string, project: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(engine, ["--path", project, "--editor"], { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(child.pid!); });
  });
}

/** Abort bounded waits immediately when the workspace changes or automatic connection is disabled. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}

export class GodotConnectionManager {
  private connection: GodotConnectionStatus = { projectPath: null, phase: "idle", message: "尚未打开 Godot 项目" };
  private project: string | null = null;
  private controller = new AbortController();
  private inFlight: Promise<GodotConnectResult> | null = null;
  private listeners = new Set<(status: GodotRpcBridgeStatus) => void>();
  private launched = new Map<string, { pid: number; engine: string }>();
  private unsubscribe: () => void;
  private disposed = false;

  constructor(private readonly bridge: GodotRpcBridge, private readonly deps: GodotConnectionDeps) {
    this.unsubscribe = bridge.onStatus(() => this.observe());
    this.observe();
  }

  /** Read one authoritative lifecycle snapshot without filesystem work in renderer polling paths. */
  getStatus(): GodotRpcBridgeStatus {
    return { ...this.bridge.getStatus(), connection: this.connection };
  }

  /** Subscribe once per app surface; polling remains a recovery fallback. */
  onStatus(listener: (status: GodotRpcBridgeStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Publish project progress while preserving separate bridge diagnostics and tool permissions. */
  private publish(patch: Partial<GodotConnectionStatus>): void {
    this.connection = { ...this.connection, ...patch };
    for (const listener of this.listeners) listener(this.getStatus());
  }

  /** Follow the session's committed project binding, never a renderer-supplied filesystem path. */
  private observe(): void {
    if (this.disposed) return;
    const project = this.bridge.getCurrentCwd();
    if (normalizeProjectKey(project ?? "") !== normalizeProjectKey(this.project ?? "")) {
      this.controller.abort();
      this.controller = new AbortController();
      this.inFlight = null;
      this.project = project;
      this.connection = { projectPath: project, phase: "idle", message: "尚未打开 Godot 项目" };
      if (project && this.deps.isProject(project)) {
        if (this.deps.prefs().godotAutoConnect) void this.connect();
        else {
          try { this.publish({ phase: "disabled", message: "自动连接已关闭，可手动连接 Godot", addon: this.deps.inspect(project) }); }
          catch { this.publish({ phase: "disabled", message: "自动连接已关闭，可手动连接 Godot" }); }
        }
      } else this.publish({});
      return;
    }
    if (project && !this.inFlight && this.connection.phase !== "disabled") {
      const clients = projectGodotClients(project, this.bridge.getStatus());
      if (clients.length && this.connection.phase !== "connected") void this.connect();
      else if (!clients.length && this.connection.phase === "connected") {
        this.publish({ phase: "connecting", message: "Godot 已断开，正在等待编辑器自动重连" });
      }
    }
    this.publish({});
  }

  /** Share concurrent automatic/manual requests; a project switch cancels every stale continuation. */
  connect(): Promise<GodotConnectResult> {
    if (this.disposed || !this.project || !this.deps.isProject(this.project)) return Promise.resolve({ ok: false, error: "请先打开 Godot 项目" });
    if (this.inFlight && !this.controller.signal.aborted) return this.inFlight;
    const project = this.project;
    if (this.controller.signal.aborted) this.controller = new AbortController();
    const signal = this.controller.signal;
    const promise = this.connectProject(project, signal).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!signal.aborted) this.publish({ phase: "error", message });
      return { ok: false, error: signal.aborted ? "连接已取消" : message };
    });
    this.inFlight = promise;
    void promise.finally(() => { if (this.inFlight === promise) this.inFlight = null; });
    return promise;
  }

  /** Stop user-requested connection attempts without automatically undoing their choice. */
  async stop(): Promise<void> {
    this.controller.abort();
    this.inFlight = null;
    this.publish({ phase: "disabled", message: "Godot 连接已停止" });
    await this.bridge.stop();
  }

  /** Apply the auto-connect preference immediately without changing any Godot tool switches. */
  preferencesChanged(): void {
    if (!this.deps.prefs().godotAutoConnect) {
      this.controller.abort();
      this.inFlight = null;
      if (this.connection.phase !== "connected") this.publish({ phase: "disabled", message: "自动连接已关闭，可手动连接 Godot" });
    } else if (this.project) void this.connect();
  }

  /** Discard stale discovery when a user explicitly selects an engine during an ongoing attempt. */
  engineSelected(path?: string): void {
    this.controller.abort();
    this.inFlight = null;
    this.publish({ enginePath: path, candidates: undefined });
    void this.connect();
  }

  /** Cancel work using obsolete configuration without closing any editor or launching a replacement. */
  engineSettingsChanged(): void {
    this.controller.abort();
    this.inFlight = null;
    if (this.connection.phase !== "connected") {
      this.publish({ phase: "idle", enginePath: undefined, candidates: undefined, message: "引擎配置已更新，可重新连接 Godot" });
    }
  }

  /** Update the addon through the same status source used by automatic connection. */
  prepareAddon(): ReturnType<typeof installGodotRpcAddon> {
    if (!this.project) return { ok: false, error: "请先打开 Godot 项目" };
    const result = this.deps.install(this.project);
    if (result.ok) this.publish({ addon: this.deps.inspect(this.project) });
    return result;
  }

  /** Release listeners and pending work before transport and session shutdown. */
  dispose(): void {
    this.disposed = true;
    this.controller.abort();
    this.unsubscribe();
    this.listeners.clear();
  }

  /** Ensure a continuation still belongs to the workspace that requested it. */
  private check(signal: AbortSignal): void {
    if (signal.aborted || this.disposed) throw new Error("连接已取消");
  }

  /** Verify the selected project's editor, avoiding a global ping to another open project. */
  private async ping(project: string, signal: AbortSignal): Promise<boolean> {
    this.check(signal);
    const status = this.bridge.getStatus();
    const clients = projectGodotClients(project, status);
    const client = clients.find((entry) => entry.id === status.activeClientId) ?? clients[0];
    if (!client) return false;
    const reply = await this.bridge.request({ id: randomUUID(), method: "ping" }, 2000, { clientId: client.id, signal });
    this.check(signal);
    return reply.ok;
  }

  /** Await a responsive addon, with an import-friendly deadline and an early process-exit failure. */
  private async waitForEditor(project: string, signal: AbortSignal, timeout: number, pid?: number): Promise<boolean> {
    const deadline = Date.now() + timeout;
    do {
      if (await this.ping(project, signal)) return true;
      if (pid && !this.deps.isAlive(pid)) throw new Error("Godot 编辑器在完成连接前退出，请检查项目导入或启动错误。");
      await delay(Math.min(200, Math.max(0, deadline - Date.now())), signal);
      this.check(signal);
    } while (Date.now() < deadline);
    return false;
  }

  /** Mark readiness after health verification and refresh the installation without pinning automatic choices. */
  private async connected(project: string, signal: AbortSignal, engine?: string): Promise<GodotConnectResult> {
    this.check(signal);
    const explicit = this.deps.prefs().godotProjectEditors[normalizeProjectKey(project)];
    let message = "Godot 已连接";
    if (engine && (!explicit || normalizeProjectKey(explicit) === normalizeProjectKey(engine))) {
      try { await this.deps.remember(project, engine, signal); }
      catch { message = "Godot 已连接，但未能保存引擎路径；请检查偏好文件的权限或内容。"; }
    }
    this.check(signal);
    this.publish({ phase: "connected", message, ...(engine ? { enginePath: engine } : {}) });
    return { ok: true, hint: message, port: this.bridge.getStatus().port };
  }

  /** Attach before installing or launching; running editors receive a reload hint instead of a duplicate process. */
  private async connectProject(project: string, signal: AbortSignal): Promise<GodotConnectResult> {
    this.publish({ phase: "connecting", message: "正在连接 Godot" });
    const bridge = await this.bridge.start();
    this.check(signal);
    if (!bridge.running) throw new Error(bridge.error ?? "无法启动 Godot 连接服务");
    if (await this.ping(project, signal)) return this.connected(project, signal);

    this.publish({ phase: "discovering", message: "正在查找 Godot 编辑器" });
    const running = await this.deps.running(signal);
    this.check(signal);
    if (await this.ping(project, signal)) return this.connected(project, signal);
    const key = normalizeProjectKey(project);
    const existing = running.find((editor) => editor.projectPath && normalizeProjectKey(editor.projectPath) === key);
    const remembered = this.launched.get(key);
    const live = remembered && this.deps.isAlive(remembered.pid) ? remembered : undefined;
    let addon = this.deps.inspect(project);
    this.publish({ addon });

    const authenticated = projectGodotClients(project, this.bridge.getStatus());
    if (existing || live || authenticated.length > 0) {
      this.publish({ phase: "connecting", message: "正在等待已打开的 Godot 编辑器连接", enginePath: existing?.executablePath ?? live?.engine });
      if (await this.waitForEditor(project, signal, this.deps.attachGraceMs ?? 1800, existing?.pid ?? live?.pid)) {
        return this.connected(project, signal, existing?.executablePath ?? live?.engine);
      }
      this.check(signal);
      if (!addon.current || !addon.enabled) {
        const installed = this.deps.install(project);
        if (!installed.ok) throw new Error(installed.error ?? "插件安装失败");
        addon = this.deps.inspect(project);
      }
      const message = "当前项目已在 Godot 中打开。请在项目设置中启用 X-agent RPC，或保存后重新打开项目；无需再启动一个编辑器。";
      this.publish({ phase: "needs_reload", message, addon });
      return { ok: false, error: message };
    }

    const discovery = await this.deps.discover(project, this.deps.prefs(), running, signal);
    this.check(signal);
    if (await this.ping(project, signal)) return this.connected(project, signal);
    if (!discovery.engine) {
      const message = discovery.message ?? "请为当前项目选择 Godot 引擎";
      this.publish({ phase: "needs_engine", message, candidates: discovery.candidates });
      return { ok: false, error: message };
    }
    const engine = discovery.engine.path;
    this.publish({ phase: "preparing", message: "正在准备 Godot 插件", enginePath: engine });
    if (!addon.current || !addon.enabled) {
      const installed = this.deps.install(project);
      if (!installed.ok) throw new Error(installed.error ?? "插件安装失败");
      addon = this.deps.inspect(project);
    }
    this.check(signal);
    this.publish({ phase: "launching", message: "正在打开 Godot 编辑器", addon });
    const pid = await this.deps.launch(engine, project);
    this.launched.set(key, { pid, engine });
    this.check(signal);
    this.publish({ phase: "connecting", message: "Godot 正在加载项目，等待连接完成" });
    if (await this.waitForEditor(project, signal, this.deps.connectTimeoutMs ?? 60_000, pid)) return this.connected(project, signal, engine);
    const message = "等待 Godot 连接超时，请检查编辑器中的导入或插件错误。再次连接会优先复用已启动的编辑器。";
    this.publish({ phase: "error", message });
    return { ok: false, error: message };
  }
}

/** Compose OS and persistence adapters once; tests inject deterministic alternatives. */
export function createGodotConnectionManager(bridge: GodotRpcBridge): GodotConnectionManager {
  return new GodotConnectionManager(bridge, {
    prefs: getCachedPrefs,
    isProject: (path) => existsSync(join(path, "project.godot")),
    inspect: inspectGodotRpcAddon,
    install: installGodotRpcAddon,
    running: listRunningGodotEditors,
    discover: (project, prefs, running, signal) => discoverGodotEngine(project, prefs, running, { signal }),
    launch: launchEditor,
    isAlive: (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } },
    remember: async (_project, engine, signal) => {
      const installation = await probeGodotEngine(engine, signal);
      signal.throwIfAborted();
      if (installation) await registerGodotEngine({ ...installation, name: godotEngineName(installation.version) }, signal);
    },
  });
}
