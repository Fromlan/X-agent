import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type {
  GodotRpcBridgeStatus,
  GodotRpcClientInfo,
  GodotRpcEvent,
  GodotRpcHandshakeFailure,
  GodotRpcRequest,
  GodotRpcRequestOptions,
  GodotRpcResponse,
} from "../../shared/godot-rpc";
import { GODOT_RPC_BASE_TIMEOUT_MS, GODOT_RPC_DEFAULT_PORT } from "../../shared/godot-rpc";
import { ensureAgentDir } from "./prefs";
import { fileExistsAsync, readJsonAsync, writeJsonAtomic } from "./lib/atomic-write";

type Listener = (status: GodotRpcBridgeStatus) => void;

type ClientState = {
  id: string;
  socket: Socket;
  projectPath?: string;
  godotVersion?: string;
  /** Addon version reported on editor_ready (0.3.0+ only). */
  addonVersion?: string;
  connectedAt: string;
  /** True after editor_ready with matching endpoint token. */
  authenticated: boolean;
};

export type GodotRpcStartOptions = {
  /** Extra ports to try after preferred (preferred+1 …). Default 9 → 10 attempts. */
  fallbackPorts?: number;
};

function formatListenError(err: unknown, port: number): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  if (code === "EADDRINUSE") {
    return `端口 ${port} 已被占用。可点「启动桥接」自动改用空闲端口，或关闭占用该端口的进程。`;
  }
  return err instanceof Error ? err.message : String(err);
}

function isAddrInUse(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: unknown }).code === "EADDRINUSE",
  );
}

/** endpoint 文件的负载格式版本，便于未来扩展字段而不破坏旧插件。 */
const ENDPOINT_FILE_VERSION = 1;

/** token 必须是 randomUUID 去横杠后的 32 位 hex，防止把其它文件误当 endpoint。 */
const ENDPOINT_TOKEN_RE = /^[0-9a-f]{32}$/i;

/** 桥接仅监听回环地址，endpoint 中的 host 也必须是回环。 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

type EndpointFile = {
  host?: unknown;
  port?: unknown;
  token?: unknown;
  version?: unknown;
  updatedAt?: unknown;
};

/** 测试注入的 endpoint 路径；为 null 时使用用户家目录下的真实路径。 */
let endpointPathOverride: string | null = null;

/**
 * @internal 供离线测试隔离 endpoint 文件 I/O，避免污染 ~/.pi/agent。
 * 传 null 恢复默认路径。
 */
export function setGodotRpcEndpointPathForTests(path: string | null): void {
  endpointPathOverride = path;
}

export function godotRpcEndpointPath(): string {
  return (
    endpointPathOverride ??
    join(homedir(), ".pi", "agent", "x-agent-godot-rpc.json")
  );
}

/**
 * 读取上次写出的 endpoint，用于复用 token 与端口，
 * 使「先启动 Godot、后启动 X-agent」时已在运行的插件无需重装即可握手成功。
 *
 * 任一校验失败（文件不存在 / JSON 损坏 / token 格式非法 / 端口越界 / host 非回环）
 * 都返回 null，由调用方回退到「新生成 token」路径。
 */
async function readEndpointForReuse(): Promise<{
  port: number;
  token: string;
} | null> {
  const path = godotRpcEndpointPath();
  if (!(await fileExistsAsync(path))) return null;

  const data = await readJsonAsync<EndpointFile | null>(path, null);
  if (!data || typeof data !== "object") return null;

  const { host, port, token } = data;
  if (typeof token !== "string" || !ENDPOINT_TOKEN_RE.test(token)) return null;
  if (typeof port !== "number" || !Number.isInteger(port)) return null;
  if (port <= 0 || port >= 65536) return null;
  // host 缺省视为回环；显式写了非回环地址则拒绝复用（可能被篡改）。
  if (host !== undefined && (typeof host !== "string" || !LOOPBACK_HOSTS.has(host))) {
    return null;
  }
  return { port, token };
}

/**
 * JSON-lines TCP RPC bridge for the Godot editor addon.
 * Supports multiple editor clients with explicit routing by client id.
 */
export class GodotRpcBridge {
  private server: Server | null = null;
  private clients = new Map<string, ClientState>();
  private socketToId = new WeakMap<Socket, string>();
  private activeClientId: string | null = null;
  private port = GODOT_RPC_DEFAULT_PORT;
  /** Shared secret written to endpoint file; required on editor_ready. */
  private authToken = "";
  private lastEvent: GodotRpcEvent | undefined;
  private lastError: string | undefined;
  private lastWarning: string | undefined;
  /** 最近一次成功 start 的 Unix ms（未启动时为 undefined）。 */
  private startedAt: number | undefined;
  /** 自上次 start 以来的握手失败累计次数。 */
  private handshakeFailures = 0;
  private lastHandshakeFailure: GodotRpcHandshakeFailure | undefined;
  private lastAddonVersion: string | undefined;
  private listeners = new Set<Listener>();
  private pending = new Map<
    string,
    { resolve: (v: GodotRpcResponse) => void; timer: NodeJS.Timeout }
  >();
  private buffers = new WeakMap<Socket, string>();

  /** Test/helper: current auth token (empty before start). */
  getAuthToken(): string {
    return this.authToken;
  }

  onStatus(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): GodotRpcBridgeStatus {
    return {
      running: Boolean(this.server?.listening),
      port: this.port,
      clients: this.clients.size,
      clientInfos: this.listClients(),
      activeClientId: this.activeClientId,
      lastEvent: this.lastEvent,
      authenticatedClients: this.countAuthenticatedClients(),
      handshakeFailures: this.handshakeFailures,
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
      ...(this.lastHandshakeFailure
        ? { lastHandshakeFailure: this.lastHandshakeFailure }
        : {}),
      ...(this.lastAddonVersion
        ? { lastAddonVersion: this.lastAddonVersion }
        : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
      ...(this.lastWarning ? { warning: this.lastWarning } : {}),
    };
  }

  /** 已通过 token 握手的客户端数（区别于 `clients` 的裸 socket 计数）。 */
  private countAuthenticatedClients(): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.authenticated) count += 1;
    }
    return count;
  }

  listClients(): GodotRpcClientInfo[] {
    return [...this.clients.values()]
      .map((c) => ({
        id: c.id,
        projectPath: c.projectPath,
        godotVersion: c.godotVersion,
        addonVersion: c.addonVersion,
        connectedAt: c.connectedAt,
      }))
      .sort((a, b) => a.connectedAt.localeCompare(b.connectedAt));
  }

  setActiveClient(clientId: string | null): boolean {
    if (clientId === null) {
      this.activeClientId = null;
      this.emitStatus();
      return true;
    }
    if (!this.clients.has(clientId)) return false;
    this.activeClientId = clientId;
    this.emitStatus();
    return true;
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  }

  private async writeEndpointFile(): Promise<boolean> {
    try {
      ensureAgentDir();
      await writeJsonAtomic(godotRpcEndpointPath(), {
        host: "127.0.0.1",
        port: this.port,
        token: this.authToken,
        version: ENDPOINT_FILE_VERSION,
        updatedAt: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      // 非致命,但 Godot addon 可能读不到 endpoint,告知用户排查。
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[godot-rpc] 写入 endpoint 文件失败（${godotRpcEndpointPath()}）：${message}`,
      );
      this.lastWarning = `endpoint 文件写入失败：${message}`;
      return false;
    }
  }

  private discardServer(): void {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.removeAllListeners();
    try {
      server.close();
    } catch {
      // ignore
    }
  }

  private removeClient(socket: Socket): void {
    const id = this.socketToId.get(socket);
    if (!id) return;
    this.clients.delete(id);
    this.socketToId.delete(socket);
    if (this.activeClientId === id) {
      this.activeClientId = this.clients.keys().next().value ?? null;
    }
    this.lastEvent = { type: "disconnected", clientId: id };
    this.emitStatus();
  }

  private async tryListen(port: number): Promise<{ ok: true } | { ok: false; err: unknown }> {
    this.discardServer();
    this.port = port;

    const server = createServer((socket) => {
      const id = randomUUID();
      const state: ClientState = {
        id,
        socket,
        connectedAt: new Date().toISOString(),
        authenticated: false,
      };
      this.clients.set(id, state);
      this.socketToId.set(socket, id);
      this.buffers.set(socket, "");
      this.emitStatus();
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => this.onData(socket, String(chunk)));
      socket.on("close", () => this.removeClient(socket));
      socket.on("error", () => this.removeClient(socket));
    });
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          server.off("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      });
      return { ok: true };
    } catch (err) {
      this.discardServer();
      return { ok: false, err };
    }
  }

  async start(
    preferredPort = GODOT_RPC_DEFAULT_PORT,
    options: GodotRpcStartOptions = {},
  ): Promise<GodotRpcBridgeStatus> {
    if (this.server?.listening) {
      this.lastError = undefined;
      return this.getStatus();
    }

    const fallbackPorts = options.fallbackPorts ?? 9;
    const attempts = Math.max(1, fallbackPorts + 1);
    this.lastError = undefined;
    this.lastWarning = undefined;
    this.handshakeFailures = 0;
    this.lastHandshakeFailure = undefined;
    // 保留调用方传入的原始端口，端口回退时的 warning 文案要参照此值。
    const originalPreferred = preferredPort;

    // 优先复用上次 endpoint 的 token + 端口，使「先开 Godot、后开 X-agent」无需重装插件。
    const reused = await readEndpointForReuse();
    if (reused) {
      this.authToken = reused.token;
      preferredPort = reused.port;
    } else {
      this.authToken = randomUUID().replace(/-/g, "");
    }

    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      const port = preferredPort + i;
      const result = await this.tryListen(port);
      if (result.ok) {
        if (i > 0) {
          this.lastWarning = `端口 ${originalPreferred} 被占用，已自动改用 ${port}`;
        } else if (reused && reused.port !== originalPreferred) {
          this.lastWarning = `已沿用上次 endpoint（端口 ${port}）`;
        } else if (reused) {
          this.lastWarning = `已沿用上次 endpoint（端口 ${port}）`;
        }
        this.lastError = undefined;
        // 在 await 写盘之前就标记 startedAt，使 renderer 立刻能在 status 中读到。
        this.startedAt = Date.now();
        this.emitStatus();
        // 改为 await：消除「插件在 endpoint 文件就绪前就已连上」的竞态。
        // 仍保持在 listen 成功之后，避免「listen 失败但文件已更新」导致插件指向不存在的服务。
        await this.writeEndpointFile();
        return this.getStatus();
      }
      lastErr = result.err;
      if (!isAddrInUse(result.err)) {
        this.lastError = formatListenError(result.err, port);
        this.emitStatus();
        return this.getStatus();
      }
    }

    const lastPort = preferredPort + attempts - 1;
    this.lastError =
      attempts === 1
        ? formatListenError(lastErr, preferredPort)
        : `端口 ${originalPreferred}–${lastPort} 均被占用，请关闭占用进程后重试。`;
    this.emitStatus();
    return this.getStatus();
  }

  async stop(): Promise<void> {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ id: "stopped", ok: false, error: "bridge stopped" });
    }
    this.pending.clear();
    for (const client of this.clients.values()) client.socket.destroy();
    this.clients.clear();
    this.activeClientId = null;
    this.authToken = "";
    this.lastError = undefined;
    this.lastWarning = undefined;
    this.startedAt = undefined;
    this.handshakeFailures = 0;
    this.lastHandshakeFailure = undefined;
    this.lastAddonVersion = undefined;
    await new Promise<void>((resolve) => {
      const server = this.server;
      this.server = null;
      if (!server) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    // 故意不删除 endpoint 文件：
    //   - stop() 只在 window-all-closed 正常路径执行；崩溃 / taskkill 本来就不会清。
    //   - 保留文件让下次 start() 能复用旧 token，使已运行的 Godot 插件无需重装即可恢复。
    this.emitStatus();
  }

  private onData(socket: Socket, chunk: string): void {
    const prev = this.buffers.get(socket) ?? "";
    const combined = prev + chunk;
    const parts = combined.split("\n");
    this.buffers.set(socket, parts.pop() ?? "");
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.onMessage(socket, trimmed);
    }
  }

  private onMessage(socket: Socket, raw: string): void {
    try {
      const msg = JSON.parse(raw) as GodotRpcResponse | GodotRpcEvent | { type?: string };
      if ("id" in msg && typeof (msg as GodotRpcResponse).id === "string") {
        const response = msg as GodotRpcResponse;
        const pending = this.pending.get(response.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(response.id);
          pending.resolve(response);
        }
        return;
      }
      if ("type" in msg && typeof msg.type === "string") {
        const clientId = this.socketToId.get(socket);
        const event = { ...(msg as GodotRpcEvent), ...(clientId ? { clientId } : {}) };
        if (event.type === "editor_ready" && clientId) {
          const state = this.clients.get(clientId);
          if (!state) return;
          const token =
            typeof (msg as { token?: unknown }).token === "string"
              ? (msg as { token: string }).token
              : "";
          const addonVersionRaw = (msg as { addonVersion?: unknown }).addonVersion;
          const addonVersion =
            typeof addonVersionRaw === "string" && addonVersionRaw.length > 0
              ? addonVersionRaw
              : undefined;

          // 异常路径：桥接没签发过 token（理论上 start 一定会给）。
          if (!this.authToken) {
            this.lastWarning = "Godot RPC 握手失败：桥接未签发 token（异常路径）";
            socket.destroy();
            return;
          }
          if (!token) {
            // 0.2.0 之前的老插件没有 token 字段 → 提示用户覆盖安装。
            this.handshakeFailures += 1;
            this.lastHandshakeFailure = "missing_token";
            this.lastWarning =
              "Godot RPC 握手失败：缺少 token（请在 Godot 中点击「安装/更新 RPC 插件」覆盖后再启动编辑器）";
            socket.destroy();
            return;
          }
          if (token !== this.authToken) {
            this.handshakeFailures += 1;
            this.lastHandshakeFailure = "bad_token";
            this.lastWarning = addonVersion
              ? `Godot RPC 握手失败：token 不匹配（插件 v${addonVersion}）。请重新安装 RPC 插件并重启 Godot。`
              : "Godot RPC 握手失败：token 不匹配（请重新安装 RPC 插件并重启 Godot）";
            socket.destroy();
            return;
          }
          state.authenticated = true;
          state.addonVersion = addonVersion;
          state.projectPath = event.projectPath;
          state.godotVersion = event.godotVersion;
          this.lastAddonVersion = addonVersion;
          if (!this.activeClientId) this.activeClientId = clientId;
        }
        this.lastEvent = event;
        this.emitStatus();
      }
    } catch {
      // ignore malformed
    }
  }

  private resolveClient(
    options?: GodotRpcRequestOptions,
  ): ClientState | null {
    if (this.clients.size === 0) return null;
    const preferred = options?.clientId ?? this.activeClientId;
    if (preferred) {
      const hit = this.clients.get(preferred);
      if (hit && !hit.socket.destroyed && hit.authenticated) return hit;
    }
    for (const client of this.clients.values()) {
      if (!client.socket.destroyed && client.authenticated) return client;
    }
    return null;
  }

  async request(
    req: GodotRpcRequest,
    timeoutMs = GODOT_RPC_BASE_TIMEOUT_MS,
    options?: GodotRpcRequestOptions,
  ): Promise<GodotRpcResponse> {
    const client = this.resolveClient(options);
    if (!client) {
      return { id: req.id, ok: false, error: "no Godot editor connected" };
    }
    if (options?.clientId && !this.clients.has(options.clientId)) {
      return {
        id: req.id,
        ok: false,
        error: `Godot client not found: ${options.clientId}`,
      };
    }
    const payload = `${JSON.stringify(req)}\n`;
    client.socket.write(payload);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        resolve({ id: req.id, ok: false, error: "timeout" });
      }, timeoutMs);
      this.pending.set(req.id, { resolve, timer });
    });
  }
}
