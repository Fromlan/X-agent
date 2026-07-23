import { createServer, type Server, type Socket } from "node:net";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  GodotRpcBridgeStatus,
  GodotRpcEvent,
  GodotRpcRequest,
  GodotRpcResponse,
} from "../../shared/godot-rpc";
import { GODOT_RPC_BASE_TIMEOUT_MS, GODOT_RPC_DEFAULT_PORT } from "../../shared/godot-rpc";
import { ensureAgentDir } from "./prefs";

type Listener = (status: GodotRpcBridgeStatus) => void;

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
 * One request/response or event object per line.
 */
export class GodotRpcBridge {
  private server: Server | null = null;
  private clients = new Set<Socket>();
  private port = GODOT_RPC_DEFAULT_PORT;
  private lastEvent: GodotRpcEvent | undefined;
  private lastError: string | undefined;
  private lastWarning: string | undefined;
  private listeners = new Set<Listener>();
  private pending = new Map<
    string,
    { resolve: (v: GodotRpcResponse) => void; timer: NodeJS.Timeout }
  >();
  private buffers = new WeakMap<Socket, string>();

  onStatus(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): GodotRpcBridgeStatus {
    return {
      running: Boolean(this.server?.listening),
      port: this.port,
      clients: this.clients.size,
      lastEvent: this.lastEvent,
      ...(this.lastError ? { error: this.lastError } : {}),
      ...(this.lastWarning ? { warning: this.lastWarning } : {}),
    };
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  }

  private writeEndpointFile(): void {
    try {
      ensureAgentDir();
      writeFileSync(
        godotRpcEndpointPath(),
        JSON.stringify(
          { host: "127.0.0.1", port: this.port, updatedAt: new Date().toISOString() },
          null,
          2,
        ),
        "utf8",
      );
    } catch {
      // non-fatal
    }
  }

  private clearEndpointFile(): void {
    try {
      const path = godotRpcEndpointPath();
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // ignore
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

  private async tryListen(port: number): Promise<{ ok: true } | { ok: false; err: unknown }> {
    this.discardServer();
    this.port = port;

    const server = createServer((socket) => {
      this.clients.add(socket);
      this.buffers.set(socket, "");
      this.emitStatus();
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => this.onData(socket, String(chunk)));
      socket.on("close", () => {
        this.clients.delete(socket);
        this.lastEvent = { type: "disconnected" };
        this.emitStatus();
      });
      socket.on("error", () => {
        this.clients.delete(socket);
      });
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
    for (const client of this.clients) client.destroy();
    this.clients.clear();
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
      this.onMessage(trimmed);
    }
  }

  private onMessage(raw: string): void {
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
        this.lastEvent = msg as GodotRpcEvent;
        this.emitStatus();
      }
    } catch {
      // ignore malformed
    }
  }

  async request(
    req: GodotRpcRequest,
    timeoutMs = GODOT_RPC_BASE_TIMEOUT_MS,
  ): Promise<GodotRpcResponse> {
    if (this.clients.size === 0) {
      return { id: req.id, ok: false, error: "no Godot editor connected" };
    }
    const payload = `${JSON.stringify(req)}\n`;
    for (const client of this.clients) {
      if (!client.destroyed) {
        client.write(payload);
        break;
      }
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        resolve({ id: req.id, ok: false, error: "timeout" });
      }, timeoutMs);
      this.pending.set(req.id, { resolve, timer });
    });
  }
}
