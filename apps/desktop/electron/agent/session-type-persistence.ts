/**
 * Session type sidecar persistence.
 *
 * Per-session type is locked at creation and stored in a sidecar JSON file
 * named `<sessionPath>.session-type.json` (NOT inside the .jsonl so we don't
 * need to teach the Pi SessionManager about our schema). Pattern mirrors
 * plan-journal / goal-journal: atomic write and silent cleanup failure.
 * Existing unreadable/invalid records fail closed so a design conversation
 * cannot acquire code permissions merely because its sidecar was damaged.
 *
 * Old sessions without a sidecar are treated as "code" — backward compatible
 * with all sessions created before this feature shipped.
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { writeJsonAtomicSync } from "./lib/atomic-write";
import {
  DEFAULT_SESSION_TYPE,
  isSessionType,
  type SessionType,
} from "../../shared/session-type";

export type SessionTypeRecord = {
  version: 1;
  sessionType: SessionType;
  updatedAt: number;
};

function sidecarPath(sessionPath: string): string {
  return `${sessionPath}.session-type.json`;
}

/** Persist the permission-bearing type atomically before a new session can be published. */
export function saveSessionType(
  sessionPath: string,
  sessionType: SessionType,
): void {
  if (!sessionPath.trim()) return;
  if (!isSessionType(sessionType)) return;
  const path = sidecarPath(sessionPath);
  const dir = dirname(path);
  const record: SessionTypeRecord = {
    version: 1,
    sessionType,
    updatedAt: Date.now(),
  };
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeJsonAtomicSync(path, record);
  } catch (err) {
    throw new Error(`会话类型记录保存失败，已保留原文件（${(err as NodeJS.ErrnoException).code ?? "I/O"}）`);
  }
}

/** Restore a locked type; only a missing legacy sidecar defaults to code. */
export function loadSessionType(sessionPath: string): SessionType {
  if (!sessionPath.trim()) return DEFAULT_SESSION_TYPE;
  const path = sidecarPath(sessionPath);
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_SESSION_TYPE;
    throw new Error(`会话类型记录不可读取，已保留原文件（${(err as NodeJS.ErrnoException).code ?? "I/O"}）`);
  }
  let raw: unknown;
  try { raw = JSON.parse(content); }
  catch { throw new Error("会话类型记录 JSON 损坏，已保留原文件；请修复后重试"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      (raw as SessionTypeRecord).version !== 1 || !isSessionType((raw as SessionTypeRecord).sessionType)) {
    throw new Error("会话类型记录结构不合法，已保留原文件；请修复后重试");
  }
  return (raw as SessionTypeRecord).sessionType;
}

export function clearSessionType(sessionPath: string): void {
  if (!sessionPath.trim()) return;
  const path = sidecarPath(sessionPath);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore — 跟 plan-journal 一致
    }
  }
}
