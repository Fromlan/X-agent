#!/usr/bin/env node
/**
 * Long-lived TCP JSON-lines bridge between the Godot editor addon and the
 * MiniMax MCP server.  Mirrors `apps/desktop/electron/agent/godot-rpc-bridge.ts`
 * with the Electron-specific pieces (ensureAgentDir, dbgLog, etc.) stripped
 * and the endpoint path switched to `${PLUGIN_DATA}/bridge-endpoint.json`.
 *
 * Pure Node.js stdlib.  No npm dependencies.
 */

import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  GODOT_RPC_DEFAULT_PORT,
  GODOT_RPC_FALLBACK_PORT_END,
  GODOT_RPC_BASE_TIMEOUT_MS,
  ENDPOINT_FILE_VERSION,
  FALLBACK_PORT_COUNT,
  isAllowedGodotRpcMethod,
} from "../scripts/common/protocol.mjs";
import {
  appendLog,
  clearEndpoint,
  lastClientPath,
  pluginDataDir,
  readEndpoint,
  writeEndpoint,
} from "../scripts/common/endpoint.mjs";

const HOST = "127.0.0.1";

const EXPECTED_MIN_ADDON_VERSION = "0.3.0";

function logLine(...args) {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  // eslint-disable-next-line no-console
  console.log(line);
  void appendLog(line);
}

function logWarn(...args) {
  const line = "[warn] " + args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  // eslint-disable-next-line no-console
  console.warn(line);
  void appendLog(line);
}

function isAddrInUse(err) {
  return Boolean(err && err.code === "EADDRINUSE");
}

function formatListenError(err, port) {
  if (isAddrInUse(err)) {
    return `Port ${port} is already in use. Stop the process holding it, or start godot-connector with GODOT_CONNECTOR_PORT=<free>.`;
  }
  return err && err.message ? err.message : String(err);
}

function normalizeCwd(cwd) {
  if (!cwd) return null;
  const absolute = resolve(cwd);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function projectPathMatchesCwd(projectPath, cwd) {
  if (!projectPath || !cwd) return true;
  const a = normalizeCwd(projectPath);
  const b = cwd;
  if (a === b) return true;
  const aTrim = a.replace(/[\\/]+$/, "");
  const bTrim = b.replace(/[\\/]+$/, "");
  return aTrim === bTrim;
}

class ClientState {
  constructor(id, socket) {
    this.id = id;
    this.socket = socket;
    this.projectPath = undefined;
    this.godotVersion = undefined;
    this.addonVersion = undefined;
    this.connectedAt = new Date().toISOString();
    this.authenticated = false;
  }
}

class GodotBridge {
  constructor() {
    this.server = null;
    this.port = GODOT_RPC_DEFAULT_PORT;
    this.authToken = "";
    this.clients = new Map();
    this.socketToId = new WeakMap();
    this.buffers = new WeakMap();
    this.activeClientId = null;
    this.pending = new Map();
    this.lastEvent = undefined;
    this.lastHandshakeFailure = undefined;
    this.lastAddonVersion = undefined;
    this.currentCwd = null;
  }

  bindCwd(cwd) {
    this.currentCwd = cwd ? normalizeCwd(cwd) : null;
  }

  setActiveClient(clientId) {
    if (clientId === null) {
      this.activeClientId = null;
      return true;
    }
    const c = this.clients.get(clientId);
    if (!c || !c.authenticated) return false;
    if (this.currentCwd && !projectPathMatchesCwd(c.projectPath, this.currentCwd)) {
      logWarn(`rejected active client ${clientId}: project mismatch`);
      return false;
    }
    this.activeClientId = clientId;
    return true;
  }

  pickActiveAfterChange() {
    if (this.currentCwd) {
      const active = this.activeClientId ? this.clients.get(this.activeClientId) : null;
      if (!active || !projectPathMatchesCwd(active.projectPath, this.currentCwd)) {
        const first = [...this.clients.values()].find((c) =>
          projectPathMatchesCwd(c.projectPath, this.currentCwd)
        );
        this.activeClientId = first?.id ?? null;
      }
    }
  }

  addClient(socket) {
    const id = randomUUID();
    const state = new ClientState(id, socket);
    this.clients.set(id, state);
    this.socketToId.set(socket, id);
    this.buffers.set(socket, "");
    if (!this.activeClientId && !this.currentCwd) {
      this.activeClientId = id;
    }
  }

  removeClient(socket) {
    const id = this.socketToId.get(socket);
    if (!id) return;
    this.clients.delete(id);
    if (this.activeClientId === id) {
      const first = [...this.clients.values()].find((c) => c.authenticated);
      this.activeClientId = first?.id ?? null;
    }
    for (const [reqId, entry] of this.pending) {
      if (entry.clientId !== id) continue;
      clearTimeout(entry.timer);
      this.pending.delete(reqId);
      entry.resolve({ id: reqId, ok: false, error: "Godot editor disconnected" });
    }
  }

  resolveClient(options) {
    if (this.clients.size === 0) {
      return { client: null, reason: "no Godot editor connected" };
    }
    const explicit = options?.clientId ?? null;
    const preferred = explicit ?? this.activeClientId;
    const matchesCwd = (c) =>
      !this.currentCwd || projectPathMatchesCwd(c.projectPath, this.currentCwd);

    if (preferred) {
      const hit = this.clients.get(preferred);
      if (hit && !hit.socket.destroyed && hit.authenticated) {
        if (!matchesCwd(hit)) {
          if (explicit) {
            return {
              client: null,
              reason: `Selected Godot client does not belong to the current session project (${this.currentCwd})`,
            };
          }
        } else {
          return { client: hit };
        }
      }
      if (explicit) {
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
        reason: `No connected Godot editor for project (${this.currentCwd})`,
      };
    }
    return { client: null, reason: "no Godot editor connected" };
  }

  onData(socket, chunk) {
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

  onMessage(socket, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    // 1) Request: {id, method, ...params} — sent by the MCP client (or any
    //    other non-addon peer) over TCP.  Forward to the active Godot
    //    client and stash a pending entry so we can route the response
    //    back to *this* socket when the addon replies.
    if (typeof msg.method === "string" && typeof msg.id === "string") {
      if (!isAllowedGodotRpcMethod(msg.method)) {
        this.sendJson(socket, {
          id: msg.id,
          ok: false,
          error: `method not allowed: ${msg.method}`,
        });
        return;
      }
      const { client, routedTo, reason } = this.resolveClient();
      if (!client) {
        this.sendJson(socket, {
          id: msg.id,
          ok: false,
          error: reason ?? "no Godot editor connected",
        });
        return;
      }
      const forward = { id: msg.id, method: msg.method, ...msg };
      // Drop our own keys that aren't part of the wire method payload.
      delete forward.socket;
      client.socket.write(JSON.stringify(forward) + "\n");
      this.pending.set(msg.id, {
        resolve: (res) => {
          const reply = routedTo ? { ...res, routedTo } : res;
          this.sendJson(socket, reply);
        },
        timer: setTimeout(() => {
          this.pending.delete(msg.id);
          this.sendJson(socket, { id: msg.id, ok: false, error: "timeout" });
        }, GODOT_RPC_BASE_TIMEOUT_MS),
        clientId: client.id,
        method: msg.method,
      });
      return;
    }

    // 2) Response: {id, ok, result|error} — sent by the addon for a
    //    request that the bridge forwarded earlier.
    if (typeof msg.id === "string" && (msg.ok === true || msg.ok === false)) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        pending.resolve(msg);
      }
      return;
    }

    // 3) Event: {type, ...} — sent by the addon (editor_ready,
    //    scene_changed, play_error, ...).  Events do not get a reply.
    if (typeof msg.type === "string") {
      const clientId = this.socketToId.get(socket);
      if (msg.type === "editor_ready" && clientId) {
        const state = this.clients.get(clientId);
        if (!state) return;
        const token = typeof msg.token === "string" ? msg.token : "";
        const addonVersionRaw = msg.addonVersion;
        const addonVersion =
          typeof addonVersionRaw === "string" && addonVersionRaw.length > 0
            ? addonVersionRaw
            : undefined;

        if (!this.authToken) {
          logWarn("editor_ready without server auth token; dropping");
          socket.destroy();
          return;
        }
        if (!token) {
          this.lastHandshakeFailure = "missing_token";
          logWarn("editor_ready missing token; please reinstall the Godot addon");
          socket.destroy();
          return;
        }
        if (token !== this.authToken) {
          this.lastHandshakeFailure = "bad_token";
          logWarn(
            addonVersion
              ? `editor_ready token mismatch (addon v${addonVersion}); please reinstall the Godot addon`
              : "editor_ready token mismatch; please reinstall the Godot addon"
          );
          socket.destroy();
          return;
        }
        state.authenticated = true;
        state.addonVersion = addonVersion;
        state.projectPath = msg.projectPath;
        state.godotVersion = msg.godotVersion;
        this.lastAddonVersion = addonVersion;
        if (
          addonVersion &&
          this.compareVersions(addonVersion, EXPECTED_MIN_ADDON_VERSION) < 0
        ) {
          logWarn(
            `addon v${addonVersion} is older than expected v${EXPECTED_MIN_ADDON_VERSION}; some methods may not work`
          );
        }
        if (!this.activeClientId) {
          this.activeClientId = clientId;
        } else {
          this.pickActiveAfterChange();
        }
        // Persist a snapshot for diagnostics.
        void writeFile(
          lastClientPath(),
          JSON.stringify(
            {
              projectPath: state.projectPath,
              godotVersion: state.godotVersion,
              addonVersion: state.addonVersion,
              connectedAt: state.connectedAt,
            },
            null,
            2
          ),
          "utf8"
        ).catch(() => undefined);
      }
      this.lastEvent = { type: msg.type, ...(clientId ? { clientId } : {}) };
    }
  }

  sendJson(socket, obj) {
    try {
      socket.write(JSON.stringify(obj) + "\n");
    } catch {
      // peer may have disconnected; nothing useful to do
    }
  }

  compareVersions(a, b) {
    const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
    const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const ai = pa[i] ?? 0;
      const bi = pb[i] ?? 0;
      if (ai < bi) return -1;
      if (ai > bi) return 1;
    }
    return 0;
  }

  async request(req, timeoutMs = GODOT_RPC_BASE_TIMEOUT_MS, options) {
    const { client, routedTo, reason } = this.resolveClient(options);
    if (!client) {
      return { id: req.id, ok: false, error: reason ?? "no Godot editor connected" };
    }
    const payload = JSON.stringify(req) + "\n";
    client.socket.write(payload);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        resolve({ id: req.id, ok: false, error: "timeout" });
      }, timeoutMs);
      this.pending.set(req.id, {
        resolve: (res) => resolve(routedTo ? { ...res, routedTo } : res),
        timer,
        clientId: client.id,
        method: req.method,
      });
    });
  }

  async tryListen(port) {
    if (this.server) {
      try {
        this.server.close();
      } catch {
        // ignore
      }
      this.server = null;
    }
    const server = createServer((socket) => {
      this.addClient(socket);
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => this.onData(socket, String(chunk)));
      socket.on("close", () => this.removeClient(socket));
      socket.on("error", () => this.removeClient(socket));
    });
    this.server = server;
    // Note: do NOT call server.unref().  In a standalone Node process
    // (outside Electron) we have no other refs holding the event loop, and
    // the bridge needs to keep running until explicitly shut down.  The
    // matching 1.3 change in the X-agent bridge only matters in the
    // Electron context where the main process is held alive by other
    // handles.

    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          server.off("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, HOST);
      });
      this.port = port;
      return { ok: true };
    } catch (err) {
      try {
        server.close();
      } catch {
        // ignore
      }
      this.server = null;
      return { ok: false, err };
    }
  }

  async start(preferredPort = GODOT_RPC_DEFAULT_PORT) {
    if (this.server?.listening) {
      return { running: true, port: this.port };
    }

    const envPort = Number.parseInt(process.env.GODOT_CONNECTOR_PORT ?? "", 10);
    if (Number.isInteger(envPort) && envPort > 0 && envPort < 65536) {
      preferredPort = envPort;
    }

    // Reuse existing endpoint if valid (keeps Godot addon paired without reinstall).
    const reused = await readEndpoint();
    if (reused) {
      this.authToken = reused.token;
      preferredPort = reused.port;
      logLine(`reusing endpoint token, preferred port ${preferredPort}`);
    } else {
      this.authToken = randomUUID().replace(/-/g, "");
    }

    const portMin = GODOT_RPC_DEFAULT_PORT;
    const portSpan = GODOT_RPC_FALLBACK_PORT_END - portMin + 1;
    const inCandidateRange =
      preferredPort >= portMin && preferredPort <= GODOT_RPC_FALLBACK_PORT_END;
    const wrap = (i) =>
      inCandidateRange
        ? portMin + ((((preferredPort - portMin + i) % portSpan) + portSpan) % portSpan)
        : preferredPort + i;

    const attempts = Math.max(1, FALLBACK_PORT_COUNT + 1);
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      const port = wrap(i);
      const result = await this.tryListen(port);
      if (result.ok) {
        try {
          await writeEndpoint({
            host: HOST,
            port,
            token: this.authToken,
            version: ENDPOINT_FILE_VERSION,
            updatedAt: new Date().toISOString(),
          });
        } catch (err) {
          logWarn(`failed to write endpoint file: ${err.message}`);
        }
        logLine(`godot-connector bridge listening on ${HOST}:${port}`);
        return { running: true, port };
      }
      lastErr = result.err;
      if (!isAddrInUse(result.err)) {
        return { running: false, error: formatListenError(result.err, port) };
      }
    }
    return {
      running: false,
      error: `Ports ${preferredPort}..${wrap(attempts - 1)} are all in use`,
    };
  }

  async stop() {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ id: "stopped", ok: false, error: "bridge stopped" });
    }
    this.pending.clear();
    for (const client of this.clients.values()) {
      try {
        client.socket.destroy();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.activeClientId = null;
    this.authToken = "";
    const server = this.server;
    this.server = null;
    if (server) {
      try {
        server.close();
      } catch {
        // ignore
      }
      await Promise.race([
        new Promise((resolve) => server.close(() => resolve())),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
    // Intentionally keep the endpoint file on graceful stop so the Godot
    // addon can reconnect without reinstalling.  Only crash paths leave a
    // stale file, which start-bridge.mjs will overwrite.
  }
}

async function main() {
  const cwd = process.env.MINIMAX_PROJECT_DIR || process.env.CWD || null;
  const bridge = new GodotBridge();
  if (cwd) {
    bridge.bindCwd(cwd);
    logLine(`bound to project: ${cwd}`);
  }

  const result = await bridge.start();
  if (!result.running) {
    logWarn(`bridge failed to start: ${result.error}`);
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logLine(`received ${signal}, shutting down`);
    try {
      await bridge.stop();
    } catch (err) {
      logWarn(`shutdown error: ${err.message}`);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("bridge.mjs")
) {
  main().catch((err) => {
    logWarn(`fatal: ${err?.stack ?? err}`);
    process.exit(1);
  });
}

export { GodotBridge };
