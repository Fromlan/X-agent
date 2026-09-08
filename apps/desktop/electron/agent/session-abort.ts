/**
 * `SessionHost.abort()` orchestration (issue #3 主题 E 提取).
 *
 * Lifted out of SessionHost so the host facade stays focused on
 * "接 Pi 事件 + 路由到子编排器". Abort is a discrete 3-step pipeline
 * (no-bundle guard → call session.abort → bundle-switch detect →
 * error path with stream-still-running defense) that can live here
 * as a free function and be unit-tested with a mock host, no real
 * AgentSession / Pi SDK / electron needed.
 */
import { dbgLog, dbgTimer, dbgWarn } from "../../shared/debug-log";
import type { AgentStatus, NoticeReplaceKey } from "../../shared/ipc";
import type { SessionBundle } from "./session-lifecycle";

/**
 * Snapshot deps for the abort pipeline. The host captures these once and
 * passes them into the helper; the helper never reads `this.*`.
 *
 * Kept narrower than `CwdLock`: abort only needs the bundle accessor,
 * a status mutator, and a notice emitter (for the failure-only path).
 */
export interface SessionAbortHost {
  getBundle(): SessionBundle | null;
  setStatus(status: AgentStatus, error?: string): void;
  emitReplaceableNotice(
    replaceKey: NoticeReplaceKey,
    text: string,
    level?: "info" | "warn" | "error",
  ): void;
}

/**
 * Run the `session.abort` orchestration. Mirrors the original in-line
 * pipeline from SessionHost.abort() but with the bundle / status / notice
 * plumbing injected through `host`.
 *
 * Defense in depth: even if `session.abort()` throws, we re-check
 * `isStreaming` before flipping the host to "idle" — a swallowed abort
 * would otherwise let a new prompt race against an unfinished stream
 * (renderer thinks it's idle, model is still streaming).
 */
export async function runSessionAbort(host: SessionAbortHost): Promise<{
  ok: boolean;
  cancelled?: boolean;
}> {
  const bundle = host.getBundle();
  if (!bundle) {
    dbgLog("session", "abort: no bundle");
    return { ok: false };
  }
  dbgLog("session", "abort start", {
    isStreaming: bundle.session.isStreaming,
  });
  const done = dbgTimer("session", "session.abort");
  let abortError: string | null = null;
  try {
    await bundle.session.abort();
    done();
  } catch (err) {
    abortError = err instanceof Error ? err.message : String(err);
    dbgWarn("session", "abort threw", abortError);
  }
  if (host.getBundle() !== bundle) {
    dbgLog("session", "abort: bundle switched");
    return { ok: true };
  }
  // 1.3 防御:abort 抛错时仍可能 isStreaming=true,盲目 setStatus("idle")
  // 会让 UI 以为已停止,造成新一轮 prompt 与未结束 stream 交错。
  // 重新检查:若仍 streaming,记录可见状态并写入 error。
  if (abortError) {
    if (bundle.session.isStreaming) {
      host.setStatus("error", `取消失败:${abortError}`);
      host.emitReplaceableNotice(
        "session",
        `取消失败:${abortError}。请稍后重试或重启会话。`,
        "error",
      );
      return { ok: false, cancelled: false };
    }
  }
  host.setStatus("idle");
  return { ok: true, cancelled: true };
}
