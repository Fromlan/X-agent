import { createServer, type Server, type Socket } from "node:net";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type {
  GodotRpcBridgeStatus,
  GodotRpcClientInfo,
  GodotRpcEvent,
  GodotRpcRequest,
  GodotRpcRequestOptions,
  GodotRpcResponse,
} from "../../shared/godot-rpc";
import { GODOT_RPC_BASE_TIMEOUT_MS, GODOT_RPC_DEFAULT_PORT } from "../../shared/godot-rpc";
import { ensureAgentDir } from "./prefs";

type Listener = (status: GodotRpcBridgeStatus) => void;

type ClientState = {
  id: string;
  socket: Socket;
  projectPath?: string;
  godotVersion?: string;
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

export function godotRpcEndpointPath(): string {
  return join(homedir(), ".pi", "agent", "x-agent-godot-rpc.json");
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
      ...(this.lastError ? { error: this.lastError } : {}),
      ...(this.lastWarning ? { warning: this.lastWarning } : {}),
    };
  }

  listClients(): GodotRpcClientInfo[] {
    return [...this.clients.values()]
      .map((c) => ({
        id: c.id,
        projectPath: c.projectPath,
        godotVersion: c.godotVersion,
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

  private writeEndpointFile(): boolean {
    try {
      ensureAgentDir();
      writeFileSync(
        godotRpcEndpointPath(),
        JSON.stringify(
          {
            host: "127.0.0.1",
            port: this.port,
            token: this.authToken,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
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

  private clearEndpointFile(): boolean {
    try {
      const path = godotRpcEndpointPath();
      if (existsSync(path)) unlinkSync(path);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[godot-rpc] 删除 endpoint 文件失败：${message}`);
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
    this.authToken = randomUUID().replace(/-/g, "");

    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      const port = preferredPort + i;
      const result = await this.tryListen(port);
      if (result.ok) {
        if (i > 0) {
          this.lastWarning = `端口 ${preferredPort} 被占用，已自动改用 ${port}`;
        }
        this.lastError = undefined;
        this.writeEndpointFile();
        this.emitStatus();
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
        : `端口 ${preferredPort}–${lastPort} 均被占用，请关闭占用进程后重试。`;
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
    await new Promise<void>((resolve) => {
      const server = this.server;
      this.server = null;
      if (!server) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    this.clearEndpointFile();
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
          if (!this.authToken || token !== this.authToken) {
            this.lastWarning = "Godot RPC 握手失败：token 不匹配（请更新编辑器插件）";
            socket.destroy();
            return;
          }
          state.authenticated = true;
          state.projectPath = event.projectPath;
          state.godotVersion = event.godotVersion;
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
