/**
 * Vitest 套件 —— 覆盖 ROADMAP 1.1 首批关键模块迁移：godot-rpc-bridge。
 *
 * 与 `scripts/test-godot-rpc-bridge.ts`（离线断言脚本）并存，用真实 TCP 连接
 * 验证：握手鉴权 / 请求响应配对 / 超时 / 多客户端路由 / 端口回退 / token 复用。
 * 每个用例使用独立端口与隔离 endpoint 文件，避免与开发者本机状态冲突。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createConnection, type Socket } from "node:net";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GodotRpcBridge,
  godotRpcEndpointPath,
  setGodotRpcEndpointPathForTests,
} from "./godot-rpc-bridge";

let portSeq = 18900;

function nextPort(): number {
  portSeq += 1;
  return portSeq;
}

async function waitFor(
  pred: () => boolean,
  msg: string,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting: ${msg}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

function connectMockClient(
  port: number,
  handler: (line: string, write: (obj: unknown) => void) => void,
): Promise<{ socket: Socket; close: () => void }> {
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
      resolve({ socket, close: () => socket.destroy() });
    });
    socket.once("error", reject);
  });
}

function authenticate(
  bridge: GodotRpcBridge,
  socket: Socket,
): Promise<void> {
  const before = bridge.listClients().filter((c) => Boolean(c.projectPath)).length;
  socket.write(
    `${JSON.stringify({
      type: "editor_ready",
      godotVersion: "4.3",
      projectPath: "D:/proj",
      token: bridge.getAuthToken(),
    })}\n`,
  );
  return waitFor(
    () => bridge.listClients().filter((c) => Boolean(c.projectPath)).length > before,
    "editor_ready authenticated",
  );
}

describe("GodotRpcBridge", () => {
  let bridge: GodotRpcBridge | null = null;
  let endpointDir = "";

  function isolateEndpoint(): void {
    endpointDir = mkdtempSync(join(tmpdir(), "xagent-rpc-vitest-"));
    setGodotRpcEndpointPathForTests(join(endpointDir, "x-agent-godot-rpc.json"));
  }

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
      bridge = null;
    }
    setGodotRpcEndpointPathForTests(null);
    if (endpointDir) {
      rmSync(endpointDir, { recursive: true, force: true });
      endpointDir = "";
    }
  });

  it("start 发 token；无客户端时请求报错", async () => {
    isolateEndpoint();
    bridge = new GodotRpcBridge();
    const port = nextPort();
    const status = await bridge.start(port);
    expect(status.running).toBe(true);
    expect(bridge.getStatus().clients).toBe(0);
    expect(bridge.getAuthToken().length).toBeGreaterThan(0);

    const noClient = await bridge.request({ id: "n1", method: "ping" }, 500);
    expect(noClient.ok).toBe(false);
    if (!noClient.ok) expect(noClient.error).toBe("no Godot editor connected");
  });

  it("editor_ready 握手 + ping 请求响应 + 超时", async () => {
    isolateEndpoint();
    bridge = new GodotRpcBridge();
    const port = nextPort();
    await bridge.start(port);

    const mock = await connectMockClient(port, (line, write) => {
      const msg = JSON.parse(line) as { id: string; method: string };
      if (msg.method === "ping") {
        write({ id: msg.id, ok: true, result: { pong: true } });
      }
    });
    await waitFor(() => bridge!.getStatus().clients === 1, "one client connected");

    await authenticate(bridge, mock.socket);
    expect(bridge.getStatus().lastEvent?.type).toBe("editor_ready");

    const ping = await bridge.request({ id: "p1", method: "ping" }, 2000);
    expect(ping.ok).toBe(true);
    if (ping.ok) {
      expect((ping as { result: { pong: boolean } }).result.pong).toBe(true);
    }

    const timed = await bridge.request({ id: "t1", method: "stop_scene" }, 150);
    expect(timed.ok).toBe(false);
    if (!timed.ok) expect(timed.error).toBe("timeout");

    mock.close();
    await waitFor(() => bridge!.getStatus().clients === 0, "client cleared");
    expect(bridge.getStatus().lastEvent?.type).toBe("disconnected");
  });

  it("错误 token 握手被拒并累计 handshakeFailures", async () => {
    isolateEndpoint();
    bridge = new GodotRpcBridge();
    const port = nextPort();
    await bridge.start(port);

    const mock = await connectMockClient(port, () => {});
    await waitFor(() => bridge!.getStatus().clients === 1, "connected");
    mock.socket.write(
      `${JSON.stringify({
        type: "editor_ready",
        godotVersion: "4.3",
        projectPath: "D:/proj",
        token: "wrong",
      })}\n`,
    );
    await waitFor(() => bridge!.getStatus().clients === 0, "bad token disconnects");
    expect(bridge.getStatus().handshakeFailures ?? 0).toBe(1);
    expect(bridge.getStatus().lastHandshakeFailure).toBe("bad_token");
    expect(typeof bridge.getStatus().warning).toBe("string");
    mock.close();
  });

  it("多客户端：请求路由到 active client 或显式 clientId", async () => {
    isolateEndpoint();
    bridge = new GodotRpcBridge();
    const port = nextPort();
    await bridge.start(port);

    const mockA = await connectMockClient(port, (line, write) => {
      const msg = JSON.parse(line) as { id?: string; method?: string };
      if (typeof msg.id !== "string" || typeof msg.method !== "string") return;
      write({ id: msg.id, ok: true, result: { from: "A" } });
    });
    await waitFor(() => bridge!.getStatus().clients === 1, "client A tcp");
    await authenticate(bridge, mockA.socket);

    const mockB = await connectMockClient(port, (line, write) => {
      const msg = JSON.parse(line) as { id?: string; method?: string };
      if (typeof msg.id !== "string" || typeof msg.method !== "string") return;
      write({ id: msg.id, ok: true, result: { from: "B" } });
    });
    await waitFor(() => bridge!.getStatus().clients === 2, "client B tcp");
    await authenticate(bridge, mockB.socket);

    const infos = bridge.listClients();
    expect(infos).toHaveLength(2);
    const idA = infos[0]!.id;
    const idB = infos[1]!.id;
    expect(idA).not.toBe(idB);

    expect(bridge.setActiveClient(idB)).toBe(true);
    expect(bridge.getStatus().activeClientId).toBe(idB);

    const pingB = await bridge.request({ id: "pb", method: "ping" }, 2000);
    expect((pingB as { result: { from: string } }).result.from).toBe("B");

    const pingA = await bridge.request({ id: "pa", method: "ping" }, 2000, {
      clientId: idA,
    });
    expect((pingA as { result: { from: string } }).result.from).toBe("A");

    mockA.close();
    mockB.close();
    await waitFor(() => bridge!.getStatus().clients === 0, "both cleared");
  });

  it("端口占用：fallbackPorts=0 失败，默认回退下一端口", async () => {
    isolateEndpoint();
    const a = new GodotRpcBridge();
    const b = new GodotRpcBridge();
    const port = nextPort();
    const started = await a.start(port, { fallbackPorts: 0 });
    expect(started.running).toBe(true);

    const noFallback = await b.start(port, { fallbackPorts: 0 });
    expect(noFallback.running).toBe(false);
    expect(noFallback.error?.length ?? 0).toBeGreaterThan(0);

    const fallback = await b.start(port);
    expect(fallback.running).toBe(true);
    expect(fallback.port).toBe(port + 1);
    expect(fallback.warning).toContain(String(port));

    await a.stop();
    await b.stop();

    const recovered = await b.start(port, { fallbackPorts: 0 });
    expect(recovered.running).toBe(true);
    expect(recovered.error).toBeUndefined();
    await b.stop();
    await a.stop();
  });

  it("start 复用上次 endpoint 的 token；stop 不删除 endpoint", async () => {
    isolateEndpoint();
    const epPath = join(endpointDir, "x-agent-godot-rpc.json");
    const b1 = new GodotRpcBridge();
    const port = nextPort();
    await b1.start(port);
    const token1 = b1.getAuthToken();
    expect(token1).toMatch(/^[0-9a-f]{32}$/);
    expect(b1.getStatus().startedAt ?? 0).toBeGreaterThan(0);
    expect(existsSync(epPath)).toBe(true);
    await b1.stop();
    expect(existsSync(epPath)).toBe(true);

    const b2 = new GodotRpcBridge();
    const status = await b2.start(port);
    expect(status.running).toBe(true);
    expect(b2.getAuthToken()).toBe(token1);
    expect(status.warning).toContain("沿用上次 endpoint");
    await b2.stop();
    bridge = null; // b1/b2 已手动 stop
  });

  it("非法 endpoint（host 非回环 / token 格式错 / JSON 损坏）不复用", async () => {
    isolateEndpoint();
    const epPath = join(endpointDir, "x-agent-godot-rpc.json");

    writeFileSync(
      epPath,
      JSON.stringify({ host: "0.0.0.0", port: 1, token: "a".repeat(32) }),
    );
    const b1 = new GodotRpcBridge();
    await b1.start(nextPort());
    expect(b1.getAuthToken()).not.toBe("a".repeat(32));
    await b1.stop();

    writeFileSync(
      epPath,
      JSON.stringify({ host: "127.0.0.1", port: 1, token: "not-hex" }),
    );
    const b2 = new GodotRpcBridge();
    await b2.start(nextPort());
    expect(b2.getAuthToken()).toMatch(/^[0-9a-f]{32}$/);
    await b2.stop();

    writeFileSync(epPath, "{ this is not valid json");
    const b3 = new GodotRpcBridge();
    const s3 = await b3.start(nextPort());
    expect(s3.running).toBe(true);
    expect(b3.getAuthToken()).toMatch(/^[0-9a-f]{32}$/);
    await b3.stop();
  });

  it("缺 token 的 editor_ready（旧插件）握手失败", async () => {
    isolateEndpoint();
    bridge = new GodotRpcBridge();
    const port = nextPort();
    await bridge.start(port);

    const mock = await connectMockClient(port, () => {});
    await waitFor(() => bridge!.getStatus().clients === 1, "connected");
    mock.socket.write(
      `${JSON.stringify({
        type: "editor_ready",
        godotVersion: "4.3",
        projectPath: "D:/proj",
      })}\n`,
    );
    await waitFor(() => bridge!.getStatus().clients === 0, "missing token 断开");
    expect(bridge.getStatus().handshakeFailures ?? 0).toBe(1);
    expect(bridge.getStatus().lastHandshakeFailure).toBe("missing_token");
    mock.close();
  });

  it("默认 endpoint 路径指向家目录", () => {
    expect(godotRpcEndpointPath()).toContain(".pi");
    expect(godotRpcEndpointPath().endsWith("x-agent-godot-rpc.json")).toBe(true);
  });
}, 30000);
