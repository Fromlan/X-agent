/**
 * TCP JSON-lines client for talking to the Godot RPC bridge.
 *
 * One instance per call.  Connects to the bridge's listening port, sends one
 * JSON object per line, awaits the matching response by `id`, and tears the
 * socket down.  No persistent state — the bridge keeps the multi-client
 * bookkeeping; this client is a pure RPC stub.
 */

import { connect as netConnect, createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { godotRpcTimeoutMs } from "./protocol.mjs";

/** Promise that resolves to `{host, port}` if the bridge is reachable. */
export async function probeBridge(endpoint, timeoutMs = 1_000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };
    const socket = createConnection(
      { host: endpoint.host, port: endpoint.port },
      () => finish({ ok: true })
    );
    socket.setTimeout(timeoutMs);
    socket.once("error", () => finish(null));
    socket.once("timeout", () => finish(null));
  });
}

class RpcError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "RpcError";
    this.details = details ?? null;
  }
}

/**
 * Send one RPC call and await the response.  Throws on connection failure
 * (caller maps to MCP error) or non-ok response (caller maps to MCP tool
 * error result with isError:true).
 */
export async function sendRpc(endpoint, call, overrides = {}) {
  const id = randomUUID();
  const timeoutMs =
    typeof overrides.timeoutMs === "number"
      ? overrides.timeoutMs
      : godotRpcTimeoutMs(call);

  return new Promise((resolve, reject) => {
    const socket = netConnect({
      host: endpoint.host,
      port: endpoint.port,
    });

    let buffer = "";
    let settled = false;

    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.end();
      } catch {
        // ignore
      }
      resolve(value);
    };
    const finishReject = (err) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      reject(err);
    };

    const timer = setTimeout(() => {
      finishReject(
        new RpcError(
          `godot-connector bridge timed out after ${timeoutMs}ms for method ${call.method}`
        )
      );
    }, timeoutMs);

    socket.once("error", (err) => {
      clearTimeout(timer);
      finishReject(
        new RpcError(
          `godot-connector bridge unreachable at ${endpoint.host}:${endpoint.port}: ${err.message}`,
          { code: err.code ?? null }
        )
      );
    });

    socket.once("connect", () => {
      const frame = JSON.stringify({ ...call, id }) + "\n";
      socket.write(frame, (err) => {
        if (err) {
          clearTimeout(timer);
          finishReject(
            new RpcError(`write to bridge failed: ${err.message}`)
          );
        }
      });
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length > 0) {
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            // ignore malformed line; keep reading
            nl = buffer.indexOf("\n");
            continue;
          }
          if (parsed && parsed.id === id) {
            clearTimeout(timer);
            finishResolve(parsed);
            return;
          }
        }
        nl = buffer.indexOf("\n");
      }
    });

    socket.once("end", () => {
      if (!settled) {
        clearTimeout(timer);
        finishReject(
          new RpcError("bridge closed connection before responding")
        );
      }
    });
  });
}

export { RpcError };
