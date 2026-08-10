import { createServer, type Server, type Socket } from "node:net";
import { join, normalize, resolve } from "node:path";
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
import {
  GODOT_RPC_BASE_TIMEOUT_MS,
  GODOT_RPC_DEFAULT_PORT,
  GODOT_RPC_FALLBACK_PORT_END,
} from "../../shared/godot-rpc";
import { ensureAgentDir } from "./prefs";
import { fileExistsAsync, readJsonAsync, writeJsonAtomic } from "./lib/atomic-write";
import { dbgLog } from "../../shared/debug-log";

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

/** 规范化项目 cwd：绝对路径 + 大小写归一（Windows NTFS）。 */
export function normalizeProjectCwd(cwd: string): string {
  const absolute = resolve(cwd);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

/** 比较两个项目路径是否指向同一项目（处理 Windows 大小写）。 */
export function projectPathMatchesCwd(
  projectPath: string | undefined,
  cwd: string,
): boolean {
  if (!projectPath) return false;
  const normalized = normalizeProjectCwd(projectPath);
  if (normalized === cwd) return true;
  // 兼容 Godot 端返回可能带尾斜杠 / 不同大小写的情况。
  const trimmed = normalized.replace(/[\\/]+$/, "");
  const cwdTrimmed = cwd.replace(/[\\/]+$/, "");
  return trimmed === cwdTrimmed;
}

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
  /**
   * 当前会话所属项目 cwd（规范化后）。已设置时，所有 RPC 路由仅在该 cwd
   * 项目下生效：避免一次会话切换后，旧的 / 其它项目的 Godot 编辑器还能
   * 接收/观察本会话的工具调用。
   */
  private currentCwd: string | null = null;
  private listeners = new Set<Listener>();
  private pending = new Map<
    string,
    {
      resolve: (v: GodotRpcResponse) => void;
      timer: NodeJS.Timeout;
      /** C4: 发起请求的客户端 id —— 断连时立即 reject，避免悬挂到超时。 */
      clientId: string;
      /** 诊断：请求方法（超时日志定位用）。 */
      method: string;
    }
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
    // C1: 只列出已鉴权客户端（未鉴权的裸 socket 无任何项目信息，UI 展示无意义）。
    return [...this.clients.values()]
      .filter((c) => c.authenticated)
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
    // C1: 只允许选中已鉴权客户端，避免把请求静默发往未完成握手的连接。
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) return false;
    // C11: 切换目标必须与当前会话 cwd 项目匹配（否则 renderer 可把请求
    // 改道到任意其它项目）。未匹配 → 拒绝并保留原 active，避免误判。
    if (this.currentCwd && !projectPathMatchesCwd(client.projectPath, this.currentCwd)) {
      this.lastWarning = `选中客户端 ${clientId} 所属项目与当前会话项目不一致，已拒绝`;
      this.emitStatus();
      return false;
    }
    this.activeClientId = clientId;
    this.emitStatus();
    return true;
  }

  /**
   * 绑定当前会话所属项目 cwd。已绑定时，桥接只接受该项目下的客户端
   * 作为合法 RPC 接收方；其它客户端被视为「未匹配项目」，所有走默认路由
   * 的请求都会被拦截（显式 clientId 同样会被拒绝）。
   * 传 null 解除绑定（项目关闭 / 切换中）。
   */
  setCurrentCwd(cwd: string | null): void {
    const normalized = cwd ? normalizeProjectCwd(cwd) : null;
    if (normalized === this.currentCwd) return;
    this.currentCwd = normalized;
    // 若当前 active 客户端不再匹配新 cwd，重置为首个已匹配客户端；
    // 没有匹配项则清空。
    if (this.currentCwd) {
      const active = this.activeClientId
        ? this.clients.get(this.activeClientId)
        : null;
      if (!active || !projectPathMatchesCwd(active.projectPath, this.currentCwd)) {
        const first = [...this.clients.values()].find((c) =>
          projectPathMatchesCwd(c.projectPath, this.currentCwd!),
        );
        this.activeClientId = first?.id ?? null;
      }
    }
    this.emitStatus();
  }

  /** 内部用：当前绑定的 cwd（已规范化）。null 表示未绑定。 */
  getCurrentCwd(): string | null {
    return this.currentCwd;
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
      // C1: 断连后只指向已鉴权客户端，避免请求发往未完成握手的连接。
      const firstAuthed = [...this.clients.values()].find((c) => c.authenticated);
      this.activeClientId = firstAuthed?.id ?? null;
    }
    // C4: 该客户端的在途请求立即 reject（如导出中编辑器退出，不再悬挂满超时）。
    for (const [reqId, entry] of this.pending) {
      if (entry.clientId !== id) continue;
      clearTimeout(entry.timer);
      this.pending.delete(reqId);
      entry.resolve({
        id: reqId,
        ok: false,
        error: "Godot editor disconnected",
      });
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
    // 1.3 防御：server 不 unref 会在 Electron 退出时阻塞事件循环。
    server.unref();

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

    // C6: 回退端口始终落在插件候选表 8765–8774 内（模运算环绕）。
    // 否则复用端口接近上限时回退到 8775+，插件探测不到，重连失败。
    // 显式传入候选表外的端口（测试等）保持线性回退，尊重调用方意图。
    const portMin = GODOT_RPC_DEFAULT_PORT;
    const portSpan = GODOT_RPC_FALLBACK_PORT_END - portMin + 1;
    const inCandidateRange =
      preferredPort >= portMin && preferredPort <= GODOT_RPC_FALLBACK_PORT_END;
    const wrap = (i: number): number =>
      inCandidateRange
        ? portMin +
          ((((preferredPort - portMin + i) % portSpan) + portSpan) % portSpan)
        : preferredPort + i;

    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      const port = wrap(i);
      const result = await this.tryListen(port);
      if (result.ok) {
        if (i > 0) {
          this.lastWarning = `端口 ${originalPreferred} 被占用，已自动改用 ${port}`;
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
      // 优先 reject：避免 pending.resolve 二次返回（即便 Promise 静默忽略也避免污染）。
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
    this.currentCwd = null;
    // 1.3 防御：server.close() 在仍有 keep-alive 连接时可能挂住，这里加
    // 1s 强制降级，避免 window-all-closed 后 Electron 进程被 socket 拖住。
    const server = this.server;
    this.server = null;
    if (server) {
      server.removeAllListeners();
      try {
        server.close();
      } catch {
        // ignore
      }
      await Promise.race([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      ]);
      try {
        // 实在释放不掉就 unref，保持进程不挂。
        server.unref();
      } catch {
        // ignore
      }
    }
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
          dbgLog("godot-rpc", "response matched", {
            id: response.id,
            method: pending.method,
            ok: response.ok,
            bytes: raw.length,
          });
          pending.resolve(response);
        } else {
          // 关键诊断：插件回了响应但 id 未在 pending —— 超时的另一形态。
          dbgLog("godot-rpc", "unmatched response", {
            id: response.id,
            ok: response.ok,
            bytes: raw.length,
            raw: raw.slice(0, 200),
          });
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

  /**
   * C1: 解析请求目标客户端。
   * - 显式 `options.clientId`：必须存在且已鉴权，否则返回 null（不静默改道）。
   * - 默认（activeClientId / 首个已鉴权）：activeClientId 未鉴权/失效时回退到
   *   首个已鉴权客户端，并通过 `routedTo` 告知调用方实际送达目标。
   * - C11: 若桥接已绑定 `currentCwd`，仅该项目下的客户端合法：
   *   - 显式选中不在该 cwd → 拒绝（不静默改道到其他项目）。
   *   - 默认路由在当前 cwd 项目内找不到任何客户端 → 拒绝。
   */
  private resolveClient(
    options?: GodotRpcRequestOptions,
  ): {
    client: ClientState | null;
    routedTo?: string;
    reason?: string;
  } {
    if (this.clients.size === 0) {
      return { client: null, reason: "no Godot editor connected" };
    }
    const explicit = options?.clientId ?? null;
    const preferred = explicit ?? this.activeClientId;
    const matchesCwd = (c: ClientState): boolean =>
      !this.currentCwd || projectPathMatchesCwd(c.projectPath, this.currentCwd);

    if (preferred) {
      const hit = this.clients.get(preferred);
      if (hit && !hit.socket.destroyed && hit.authenticated) {
        if (!matchesCwd(hit)) {
          if (explicit) {
            return {
              client: null,
              reason: `选中的 Godot 客户端不属于当前会话项目（${this.currentCwd}）`,
            };
          }
        } else {
          return { client: hit };
        }
      }
      if (explicit) {
        // 显式选择的目标不可用 → 不静默改道，直接失败。
        return { client: null, reason: "Godot client not found or not authenticated" };
      }
    }
    for (const client of this.clients.values()) {
      if (!client.socket.destroyed && client.authenticated && matchesCwd(client)) {
        return { client, routedTo: client.id };
      }
    }
    if (this.currentCwd) {
      return {
        client: null,
        reason: `当前会话项目（${this.currentCwd}）下没有已连接的 Godot 编辑器`,
      };
    }
    return { client: null, reason: "no Godot editor connected" };
  }

  async request(
    req: GodotRpcRequest,
    timeoutMs = GODOT_RPC_BASE_TIMEOUT_MS,
    options?: GodotRpcRequestOptions,
  ): Promise<GodotRpcResponse> {
    const { client, routedTo, reason } = this.resolveClient(options);
    if (!client) {
      return {
        id: req.id,
        ok: false,
        error: reason ?? "no Godot editor connected",
      };
    }
    const payload = `${JSON.stringify(req)}\n`;
    client.socket.write(payload);
    dbgLog("godot-rpc", "request sent", {
      id: req.id,
      method: req.method,
      clientId: client.id,
      bytes: payload.length,
    });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        dbgLog("godot-rpc", "request timed out", {
          id: req.id,
          method: req.method,
          timeoutMs,
          clientId: client.id,
        });
        resolve({ id: req.id, ok: false, error: "timeout" });
      }, timeoutMs);
      this.pending.set(req.id, {
        resolve: (res: GodotRpcResponse) =>
          resolve(routedTo ? { ...res, routedTo } : res),
        timer,
        clientId: client.id,
        method: req.method,
      });
    });
  }
}
