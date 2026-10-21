/** Match editor connectivity to the active project instead of showing another project's connection. */
import type { GodotRpcStatusDto } from "@shared/ipc";
import { normalizeProjectKey } from "@shared/project-path";

/** Only authenticated clients with the same project identify an active editor connection. */
export function isProjectGodotConnected(cwd: string | null, status: GodotRpcStatusDto | null): boolean {
  return Boolean(cwd && status?.running && (status.authenticatedClients ?? 0) > 0 &&
    status.clientInfos.some((client) => client.projectPath && normalizeProjectKey(client.projectPath) === normalizeProjectKey(cwd)));
}

/** Endpoint reuse and automatic port selection are startup bookkeeping, rather than user-facing warnings. */
export function godotConnectionWarning(warning: string | undefined): string | undefined {
  if (warning?.startsWith("已沿用上次 endpoint") || /^端口 \d+ 被占用，已自动改用 \d+$/.test(warning ?? "")) return undefined;
  return warning;
}
