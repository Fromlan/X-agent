/**
 * Truncation recovery (issue #59 主题 A 提取).
 *
 * Lifted out of SessionHost so the host facade stays focused on
 * "接 Pi 事件 + 路由到子编排器". The retry-counter + one-shot recovery
 * prompt is a self-contained flow that can live here as a free
 * function and be unit-tested without standing up the full SessionHost.
 */
import { dbgLog, dbgWarn } from "../../shared/debug-log";
import type { AgentStatus, PromptPayload, PromptResult } from "../../shared/ipc";
import type { SessionBundle } from "./session-lifecycle";

/** Marker prefix for the system-injected recovery prompt. Used by `prompt()` to
 *  tell the recovery-prompt path apart from user-typed prompts. */
export const TRUNCATION_RECOVERY_MARKER = "[system-recovery]";

/** Build the one-shot recovery hint. */
export function buildTruncationRecoveryHint(): string {
  return [
    TRUNCATION_RECOVERY_MARKER,
    "Your previous turn was truncated at max_tokens (output budget exhausted by thinking).",
    "To recover, do not do deep reasoning this turn — emit exactly one tool call now",
    "(read / grep / edit / run / godot_run_main_scene) to checkpoint progress, then",
    "read its result, then continue. Save longer thinking for the next turn.",
  ].join(" ");
}

/** Max auto-retry count before asking the user to lower thinking / switch model. */
export const MAX_TRUNCATION_RETRIES = 2;

/** Snapshot deps for truncation recovery. */
export interface TruncationRecoveryDeps {
  getBundle(): SessionBundle | null;
  getRetries(): number;
  setRetries(v: number): void;
  setStatus(status: AgentStatus, error?: string): void;
  prompt(payload: PromptPayload): Promise<PromptResult>;
}

/**
 * Called by the event-bridge when the assistant message was truncated by
 * `max_tokens` with no text / no tool call. Injects a one-shot recovery
 * prompt up to `MAX_TRUNCATION_RETRIES` times per consecutive streak.
 * On cap, surfaces an error status asking the user to lower thinking
 * or switch model — repeated auto-retry cannot shrink the input context
 * that's the real culprit.
 *
 * Recovery prompt is dispatched via `queueMicrotask` so it lands after
 * the current turn's `turn_end` event.
 */
export async function notifyTruncation(
  deps: TruncationRecoveryDeps,
  detail: { messageId: string; outputTokens: number },
): Promise<void> {
  if (!deps.getBundle()) {
    dbgLog("session", "notifyTruncation skipped: no bundle");
    return;
  }
  if (deps.getRetries() >= MAX_TRUNCATION_RETRIES) {
    dbgLog("session", "notifyTruncation capped", {
      attempts: deps.getRetries(),
      messageId: detail.messageId,
    });
    deps.setStatus(
      "error",
      `已自动重试 ${MAX_TRUNCATION_RETRIES} 次仍被 max_tokens 截断。请把设置里的 thinking 改为 off 或换 M2.7。`,
    );
    return;
  }
  deps.setRetries(deps.getRetries() + 1);
  dbgLog("session", "notifyTruncation: scheduling retry", {
    attempt: deps.getRetries(),
    messageId: detail.messageId,
    outputTokens: detail.outputTokens,
  });
  deps.setStatus("retrying", "上一轮被 max_tokens 截断,正在自动重试…");
  // Defer until after turn_end so the new turn starts cleanly.
  queueMicrotask(() => {
    if (!deps.getBundle()) {
      dbgLog("session", "notifyTruncation deferred call: bundle gone");
      return;
    }
    void deps
      .prompt({ text: buildTruncationRecoveryHint() })
      .catch((err: unknown) => {
        dbgWarn(
          "session",
          "notifyTruncation prompt failed",
          err instanceof Error ? err.message : String(err),
        );
      });
  });
}
