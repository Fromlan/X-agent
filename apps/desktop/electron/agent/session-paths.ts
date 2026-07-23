import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, normalize, relative, resolve } from "node:path";

/**
 * X-agent 独立会话根目录。
 * 与 Pi CLI 默认的 ~/.pi/agent/sessions/ 隔离。
 * @see https://pi.dev/docs/latest/sessions
 */
export function getXAgentSessionsRoot(): string {
  const root = resolve(homedir(), ".pi", "agent", "x-agent", "sessions");
  mkdirSync(root, { recursive: true });
  return root;
}

function toPosixLower(p: string): string {
  return normalize(p).replace(/\\/g, "/").toLowerCase();
}

/** 判断路径是否属于本客户端会话目录（必须是 root 下的真实子路径）。 */
export function isXAgentSessionPath(sessionPath: string): boolean {
  if (!sessionPath || typeof sessionPath !== "string") return false;
  const root = resolve(getXAgentSessionsRoot());
  const target = resolve(isAbsolute(sessionPath) ? sessionPath : resolve(root, sessionPath));
  const rel = relative(root, target);
  if (!rel || rel === ".") return false;
  // Escape outside root: relative starts with .. or is absolute
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  // Extra guard against prefix collisions on case-insensitive FS
  const rootPosix = toPosixLower(root);
  const targetPosix = toPosixLower(target);
  return targetPosix.startsWith(`${rootPosix}/`);
}
