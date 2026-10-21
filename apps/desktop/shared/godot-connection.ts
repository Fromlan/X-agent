/** Share project-scoped connection states so every surface reports the same editor readiness. */
import type { GodotRpcBridgeStatus, GodotRpcClientInfo } from "./godot-rpc";
import { normalizeProjectKey } from "./project-path";

export type GodotConnectionPhase = "idle" | "disabled" | "discovering" | "preparing" | "launching" | "connecting" | "connected" | "needs_engine" | "needs_reload" | "error";

export interface GodotConnectionStatus {
  projectPath: string | null;
  phase: GodotConnectionPhase;
  message: string;
  enginePath?: string;
  candidates?: Array<{ path: string; version: string }>;
  addon?: { installed: boolean; enabled: boolean; current: boolean; version?: string };
}

/** Only authenticated editors belonging to this project may count toward readiness. */
export function projectGodotClients(cwd: string | null, status: GodotRpcBridgeStatus | null): GodotRpcClientInfo[] {
  if (!cwd || !status?.running) return [];
  const key = normalizeProjectKey(cwd);
  return status.clientInfos.filter((client) => client.projectPath && normalizeProjectKey(client.projectPath) === key);
}

/** A managed connection becomes ready only after its project health check succeeds. */
export function isProjectGodotConnected(cwd: string | null, status: GodotRpcBridgeStatus | null): boolean {
  if (!projectGodotClients(cwd, status).length) return false;
  const connection = status?.connection;
  return !connection || normalizeProjectKey(connection.projectPath ?? "") !== normalizeProjectKey(cwd ?? "") || connection.phase === "connected";
}

/** Keep project-specific progress from leaking into a different conversation. */
export function projectGodotConnection(cwd: string | null, status: GodotRpcBridgeStatus | null): GodotConnectionStatus | undefined {
  const connection = status?.connection;
  return cwd && connection?.projectPath && normalizeProjectKey(cwd) === normalizeProjectKey(connection.projectPath) ? connection : undefined;
}
