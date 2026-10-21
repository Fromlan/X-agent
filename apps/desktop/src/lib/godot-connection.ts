/** Match editor connectivity to the active project instead of showing another project's connection. */
export { isProjectGodotConnected, projectGodotConnection } from "@shared/godot-connection";
import type { GodotRpcStatusDto } from "@shared/ipc";
import { isProjectGodotConnected, projectGodotConnection } from "@shared/godot-connection";

/** Describe the user's next step without exposing bridge ports or protocol details. */
export function godotConnectionLabel(cwd: string | null, status: GodotRpcStatusDto | null): string {
  if (isProjectGodotConnected(cwd, status)) return "Godot 已连接";
  const connection = projectGodotConnection(cwd, status);
  if (!connection) return "等待 Godot 连接";
  if (connection.phase === "needs_engine") return "选择 Godot 引擎";
  if (connection.phase === "needs_reload") return "启用 Godot 插件";
  if (connection.phase === "error") return "Godot 连接异常";
  if (connection.phase === "disabled") return "Godot 未连接";
  return connection.message;
}

/** Endpoint reuse and automatic port selection are startup bookkeeping, rather than user-facing warnings. */
export function godotConnectionWarning(warning: string | undefined): string | undefined {
  if (warning?.startsWith("已沿用上次 endpoint") || /^端口 \d+ 被占用，已自动改用 \d+$/.test(warning ?? "")) return undefined;
  return warning;
}
