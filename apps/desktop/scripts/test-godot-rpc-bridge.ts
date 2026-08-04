/**
 * Offline test for GodotRpcBridge request/response pairing and timeout.
 */
import { createConnection } from "node:net";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GodotRpcBridge,
  godotRpcEndpointPath,
  setGodotRpcEndpointPathForTests,
} from "../electron/agent/godot-rpc-bridge";

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
  // 隔离 endpoint 文件 I/O，避免 start() 复用路径读到开发者机器上真实残留的 endpoint。
  const dir = mkdtempSync(join(tmpdir(), "xagent-rpc-test-"));
  setGodotRpcEndpointPathForTests(join(dir, "x-agent-godot-rpc.json"));
  const bridge = new GodotRpcBridge();
  try {
    await bridge.start(port);
    await fn(bridge);
  } finally {
    await bridge.stop();
    setGodotRpcEndpointPathForTests(null);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 为不依赖具体 bridge 实例的端口测试隔离 endpoint 文件，避免读取开发者机器状态。
 */
async function withIsolatedEndpoint(
  prefix: string,
  fn: () => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  setGodotRpcEndpointPathForTests(join(dir, "x-agent-godot-rpc.json"));
  try {
    await fn();
  } finally {
    setGodotRpcEndpointPathForTests(null);
    rmSync(dir, { recursive: true, force: true });
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
  assert(
    (bridge.getStatus().handshakeFailures ?? 0) === 1,
    "handshakeFailures 累计 (bad_token)",
  );
  assert(
    bridge.getStatus().lastHandshakeFailure === "bad_token",
    "lastHandshakeFailure = bad_token",
  );
  assert(
    typeof bridge.getStatus().warning === "string" &&
      bridge.getStatus().warning!.includes("token"),
    "warning 描述 token 失败",
  );

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
await withIsolatedEndpoint("xagent-rpc-fallback-", async () => {
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
});

// ─── token 复用：start 沿用上次 endpoint 的 token + 端口 ───
{
  const dir = mkdtempSync(join(tmpdir(), "xagent-rpc-reuse-"));
  const epPath = join(dir, "x-agent-godot-rpc.json");
  setGodotRpcEndpointPathForTests(epPath);
  try {
    const b1 = new GodotRpcBridge();
    const port = 18801;
    await b1.start(port);
    const token1 = b1.getAuthToken();
    assert(/^[0-9a-f]{32}$/.test(token1), "first token 是 32 hex");
    assert(
      typeof b1.getStatus().startedAt === "number" && b1.getStatus().startedAt! > 0,
      "startedAt 已设",
    );
    // endpoint 文件应被原子写出
    assert(existsSync(epPath), "endpoint 文件存在");
    // stop() 不再删除 endpoint
    await b1.stop();
    assert(existsSync(epPath), "stop() 不再删除 endpoint");

    const b2 = new GodotRpcBridge();
    const status = await b2.start(port);
    assert(status.running, "复用路径仍能 listen");
    assert(b2.getAuthToken() === token1, "第二次启动 token 复用");
    assert(
      typeof status.warning === "string" &&
        status.warning!.includes("沿用上次 endpoint"),
      "warning 标注复用",
    );
    await b2.stop();
  } finally {
    setGodotRpcEndpointPathForTests(null);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── 非法 endpoint 拒绝复用（host 非回环 / token 格式错 / JSON 损坏） ───
{
  const dir = mkdtempSync(join(tmpdir(), "xagent-rpc-bad-"));
  const epPath = join(dir, "x-agent-godot-rpc.json");
  setGodotRpcEndpointPathForTests(epPath);
  try {
    // host 非回环
    writeFileSync(
      epPath,
      JSON.stringify({
        host: "0.0.0.0",
        port: 18802,
        token: "a".repeat(32),
      }),
    );
    const b1 = new GodotRpcBridge();
    await b1.start(18802);
    assert(
      b1.getAuthToken() !== "a".repeat(32),
      "host 非回环 → 不复用旧 token",
    );
    await b1.stop();

    // token 格式错误
    writeFileSync(
      epPath,
      JSON.stringify({
        host: "127.0.0.1",
        port: 18803,
        token: "not-hex",
      }),
    );
    const b2 = new GodotRpcBridge();
    await b2.start(18803);
    assert(
      /^[0-9a-f]{32}$/.test(b2.getAuthToken()),
      "token 格式错 → 新生成 32 hex",
    );
    await b2.stop();

    // JSON 损坏
    writeFileSync(epPath, "{ this is not valid json");
    const b3 = new GodotRpcBridge();
    const s3 = await b3.start(18804);
    assert(s3.running, "JSON 损坏仍能 listen");
    assert(/^[0-9a-f]{32}$/.test(b3.getAuthToken()), "JSON 损坏 → 新生成 token");
    await b3.stop();
  } finally {
    setGodotRpcEndpointPathForTests(null);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── 缺 token 握手失败计数 ───
await withBridge(18805, async (bridge) => {
  const mock = await connectMockClient(18805, () => {});
  await waitFor(() => bridge.getStatus().clients === 1, "connected");
  // 故意发不带 token 的 editor_ready（模拟 0.2.0 之前的老插件）
  mock.socket.write(
    `${JSON.stringify({
      type: "editor_ready",
      godotVersion: "4.3",
      projectPath: "D:/proj",
    })}\n`,
  );
  await waitFor(() => bridge.getStatus().clients === 0, "missing token 断开");
  assert(
    (bridge.getStatus().handshakeFailures ?? 0) === 1,
    "handshakeFailures 累计 (missing_token)",
  );
  assert(
    bridge.getStatus().lastHandshakeFailure === "missing_token",
    "lastHandshakeFailure = missing_token",
  );
});

// sanity: godotRpcEndpointPath 在没有 override 时仍指向家目录
assert(
  godotRpcEndpointPath().includes(".pi") &&
    godotRpcEndpointPath().endsWith("x-agent-godot-rpc.json"),
  "默认 endpoint 路径未受影响",
);

console.log("test-godot-rpc-bridge: ok");
