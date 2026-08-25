/**
 * Session type sidecar persistence.
 *
 * Per-session type is locked at creation and stored in a sidecar JSON file
 * named `<sessionPath>.session-type.json` (NOT inside the .jsonl so we don't
 * need to teach the Pi SessionManager about our schema). Pattern mirrors
 * plan-journal / goal-journal: atomic write, fail-open on read, silent on
 * cleanup failure.
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

export function saveSessionType(
  sessionPath: string,
  sessionType: SessionType,
): void {
  if (!sessionPath.trim()) return;
  if (!isSessionType(sessionType)) return;
  const path = sidecarPath(sessionPath);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const record: SessionTypeRecord = {
    version: 1,
    sessionType,
    updatedAt: Date.now(),
  };
  try {
    writeJsonAtomicSync(path, record);
  } catch (err) {
    // 写失败不致命: 跟 plan-journal / goal-journal 同等级, console.warn 即可。
    // 下次 resume 时读不到 sidecar → fallback 到 DEFAULT_SESSION_TYPE。
    console.warn(
      `[session-type-persistence] 写入失败 (${path}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export function loadSessionType(sessionPath: string): SessionType {
  if (!sessionPath.trim()) return DEFAULT_SESSION_TYPE;
  const path = sidecarPath(sessionPath);
  if (!existsSync(path)) return DEFAULT_SESSION_TYPE;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SessionTypeRecord;
    if (raw?.version !== 1) return DEFAULT_SESSION_TYPE;
    if (!isSessionType(raw.sessionType)) return DEFAULT_SESSION_TYPE;
    return raw.sessionType;
  } catch {
    return DEFAULT_SESSION_TYPE;
  }
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
