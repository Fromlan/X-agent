/** Lock project isolation and health-gated readiness across all renderer surfaces. */
import { describe, expect, it } from "vitest";
import { isProjectGodotConnected, projectGodotConnection } from "./godot-connection";
import type { GodotRpcBridgeStatus } from "./godot-rpc";

const status: GodotRpcBridgeStatus = {
  running: true, port: 8765, clients: 1, authenticatedClients: 1, activeClientId: "one",
  clientInfos: [{ id: "one", projectPath: "D:/Game/", connectedAt: "2026-10-21" }],
};

describe("project Godot readiness", () => {
  it("matches Windows path variants and rejects other projects and unknown paths", () => {
    expect(isProjectGodotConnected("d:\\game", status)).toBe(true);
    expect(isProjectGodotConnected("D:/other", status)).toBe(false);
    expect(isProjectGodotConnected(null, status)).toBe(false);
    expect(isProjectGodotConnected("D:/Game", { ...status, clientInfos: [] })).toBe(false);
  });
  it("requires the managed health check before declaring an authenticated socket ready", () => {
    const connection = { projectPath: "D:/Game", phase: "connecting" as const, message: "等待健康检查" };
    expect(isProjectGodotConnected("D:/Game", { ...status, connection })).toBe(false);
    expect(isProjectGodotConnected("D:/Game", { ...status, connection: { ...connection, phase: "connected" } })).toBe(true);
  });
  it("never exposes another project's connection progress", () => {
    expect(projectGodotConnection("D:/other", { ...status, connection: { projectPath: "D:/Game", phase: "error", message: "failed" } })).toBeUndefined();
  });
});
