/**
 * Offline test for GodotRpcBridge request/response pairing and timeout.
 */
import { createConnection } from "node:net";
import { GodotRpcBridge } from "../electron/agent/godot-rpc-bridge";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function waitFor(
  pred: () => boolean,
  msg: string,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting: ${msg}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function withBridge(
  port: number,
  fn: (bridge: GodotRpcBridge) => Promise<void>,
): Promise<void> {
  const bridge = new GodotRpcBridge();
  await bridge.start(port);
  try {
    await fn(bridge);
  } finally {
    await bridge.stop();
  }
}

function connectMockClient(
  port: number,
  handler: (line: string, write: (obj: unknown) => void) => void,
): Promise<{ socket: import("node:net").Socket; close: () => void }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      let buf = "";
      const write = (obj: unknown) => {
        socket.write(`${JSON.stringify(obj)}\n`);
      };
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        buf += String(chunk);
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (trimmed) handler(trimmed, write);
        }
      });
      resolve({
        socket,
        close: () => {
          socket.destroy();
        },
      });
    });
    socket.once("error", reject);
  });
}

async function authenticate(
  bridge: GodotRpcBridge,
  socket: import("node:net").Socket,
): Promise<void> {
  const authedBefore = bridge
    .listClients()
    .filter((c) => Boolean(c.projectPath)).length;
  socket.write(
    `${JSON.stringify({
      type: "editor_ready",
      godotVersion: "4.3",
      projectPath: "D:/proj",
      token: bridge.getAuthToken(),
    })}\n`,
  );
  await waitFor(
    () =>
      bridge.listClients().filter((c) => Boolean(c.projectPath)).length >
      authedBefore,
    "editor_ready authenticated",
  );
}

await withBridge(18765, async (bridge) => {
  assert(bridge.getStatus().running, "bridge running");
  assert(bridge.getStatus().clients === 0, "no clients yet");
  assert(bridge.getAuthToken().length > 0, "auth token issued");

  const noClient = await bridge.request({ id: "n1", method: "ping" }, 500);
  assert(!noClient.ok && noClient.error === "no Godot editor connected", "no client error");

  const mock = await connectMockClient(18765, (line, write) => {
    const msg = JSON.parse(line) as { id: string; method: string };
    if (msg.method === "ping") {
      write({ id: msg.id, ok: true, result: { pong: true } });
    } else if (msg.method === "get_editor_info") {
      write({
        id: msg.id,
        ok: true,
        result: { godotVersion: { string: "4.x" }, projectPath: "D:/proj" },
      });
    }
  });

  await waitFor(() => bridge.getStatus().clients === 1, "one client connected");

  // Reject bad token
  mock.socket.write(
    `${JSON.stringify({
      type: "editor_ready",
      godotVersion: "4.3",
      projectPath: "D:/proj",
      token: "wrong",
    })}\n`,
  );
  await waitFor(() => bridge.getStatus().clients === 0, "bad token disconnects");

  const mock2 = await connectMockClient(18765, (line, write) => {
    const msg = JSON.parse(line) as { id: string; method: string };
    if (msg.method === "ping") {
      write({ id: msg.id, ok: true, result: { pong: true } });
    } else if (msg.method === "get_editor_info") {
      write({
        id: msg.id,
        ok: true,
        result: { godotVersion: { string: "4.x" }, projectPath: "D:/proj" },
      });
    }
  });
  await waitFor(() => bridge.getStatus().clients === 1, "mock2 connected");
  await authenticate(bridge, mock2.socket);
  assert(bridge.getStatus().lastEvent?.type === "editor_ready", "editor_ready event");

  const ping = await bridge.request({ id: "p1", method: "ping" }, 2000);
  assert(ping.ok === true, "ping ok");
  assert(
    (ping as { result: { pong: boolean } }).result.pong === true,
    "pong true",
  );

  const info = await bridge.request({ id: "i1", method: "get_editor_info" }, 2000);
  assert(info.ok === true, "info ok");

  // timeout: send request that mock ignores
  const timed = await bridge.request({ id: "t1", method: "stop_scene" }, 200);
  assert(!timed.ok && timed.error === "timeout", "timeout when no response");

  mock2.close();
  await waitFor(() => bridge.getStatus().clients === 0, "client cleared");
  assert(bridge.getStatus().lastEvent?.type === "disconnected", "disconnected event");
});

// Multi-client routing: request goes to the selected active client only
await withBridge(18767, async (bridge) => {
  const mockA = await connectMockClient(18767, (line, write) => {
    const msg = JSON.parse(line) as { id?: string; method?: string };
    if (typeof msg.id !== "string" || typeof msg.method !== "string") return;
    write({ id: msg.id, ok: true, result: { from: "A" } });
  });
  await waitFor(() => bridge.getStatus().clients === 1, "client A tcp");
  await authenticate(bridge, mockA.socket);

  const mockB = await connectMockClient(18767, (line, write) => {
    const msg = JSON.parse(line) as { id?: string; method?: string };
    if (typeof msg.id !== "string" || typeof msg.method !== "string") return;
    write({ id: msg.id, ok: true, result: { from: "B" } });
  });
  await waitFor(() => bridge.getStatus().clients === 2, "client B tcp");
  await authenticate(bridge, mockB.socket);
  await waitFor(() => bridge.getStatus().clients === 2, "two clients");

  const infos = bridge.listClients();
  assert(infos.length === 2, "two client infos");
  // connectedAt ascending → A then B
  const idA = infos[0]!.id;
  const idB = infos[1]!.id;
  assert(idA !== idB, "distinct client ids");

  assert(bridge.setActiveClient(idB), "set active B");
  assert(bridge.getStatus().activeClientId === idB, "active is B");

  const pingB = await bridge.request({ id: "pb", method: "ping" }, 2000);
  assert(pingB.ok === true, "ping B ok");
  assert((pingB as { result: { from: string } }).result.from === "B", "routed to B");

  const pingA = await bridge.request(
    { id: "pa", method: "ping" },
    2000,
    { clientId: idA },
  );
  assert(pingA.ok === true, "explicit A ok");
  assert((pingA as { result: { from: string } }).result.from === "A", "routed to A");

  mockA.close();
  mockB.close();
  await waitFor(() => bridge.getStatus().clients === 0, "both cleared");
});

// EADDRINUSE with fallbackPorts:0 → soft error; with default fallback → next port
{
  const a = new GodotRpcBridge();
  const b = new GodotRpcBridge();
  const port = 18766;
  const started = await a.start(port, { fallbackPorts: 0 });
  assert(started.running, "first bridge owns port");

  const noFallback = await b.start(port, { fallbackPorts: 0 });
  assert(!noFallback.running, "no-fallback second bridge fails");
  assert(typeof noFallback.error === "string" && noFallback.error.length > 0, "error set");

  const fallback = await b.start(port);
  assert(fallback.running, "fallback succeeds");
  assert(fallback.port === port + 1, "uses next port");
  assert(
    typeof fallback.warning === "string" && fallback.warning.includes(String(port)),
    "warning mentions preferred port",
  );

  const again = await a.start(port);
  assert(again.running && !again.error, "owner start is idempotent");
  await a.stop();
  await b.stop();

  const recovered = await b.start(port, { fallbackPorts: 0 });
  assert(recovered.running && !recovered.error, "port free after stop");
  await b.stop();
}

console.log("test-godot-rpc-bridge: ok");
