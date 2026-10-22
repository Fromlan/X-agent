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

/** Build recovery advice from enabled inspection tools without suggesting a mutation. */
export function buildTruncationRecoveryHint(activeTools: readonly string[] = []): string {
  const inspectionTools = ["read", "grep", "find", "ls", "godot_editor_info", "godot_edited_scene"]
    .filter((name) => activeTools.includes(name));
  return [
    TRUNCATION_RECOVERY_MARKER,
    "The previous response reached its output limit without visible progress. Continue the current task from its latest confirmed state and user corrections; keep this recovery step small.",
    inspectionTools.length > 0
      ? `Enabled inspection tools: ${inspectionTools.map((name) => `\`${name}\``).join(", ")}. If inspection is useful, choose one bounded call and examine its result before proceeding.`
      : "No inspection tool is currently enabled. Give a concise progress update or take the next already-authorized task step with an available tool.",
    "Current mode, paths, and tool restrictions still apply. Do not invent tools, repeat completed work, or modify files or start the game merely to produce a checkpoint. State a concrete blocker if you cannot proceed.",
  ].join(" ");
}

/** Max auto-retry count before asking the user to lower thinking / switch model. */
export const MAX_TRUNCATION_RETRIES = 2;

// A reset retry counter can reuse the same number; a unique token prevents stale failures from matching it.
const recoveryTokens = new WeakMap<SessionBundle["session"], symbol>();

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
 * or switch model; retrying alone does not increase the output budget.
 *
 * Recovery prompt is dispatched via `queueMicrotask` so it lands after
 * the current turn's `turn_end` event.
 */
export async function notifyTruncation(
  deps: TruncationRecoveryDeps,
  detail: { messageId: string; outputTokens: number },
): Promise<void> {
  const bundle = deps.getBundle();
  if (!bundle) {
    dbgLog("session", "notifyTruncation skipped: no bundle");
    return;
  }
  const session = bundle.session;
  const token = Symbol("truncation-recovery");
  recoveryTokens.set(session, token);
  if (deps.getRetries() >= MAX_TRUNCATION_RETRIES) {
    dbgLog("session", "notifyTruncation capped", {
      attempts: deps.getRetries(),
      messageId: detail.messageId,
    });
    deps.setStatus(
      "error",
      `已自动重试 ${MAX_TRUNCATION_RETRIES} 次仍被 max_tokens 截断。请降低推理强度、缩小单次任务，或选择其他可用模型后重试。`,
    );
    return;
  }
  const attempt = deps.getRetries() + 1;
  deps.setRetries(attempt);
  dbgLog("session", "notifyTruncation: scheduling retry", {
    attempt: deps.getRetries(),
    messageId: detail.messageId,
    outputTokens: detail.outputTokens,
  });
  deps.setStatus("retrying", "上一轮被 max_tokens 截断,正在自动重试…");
  /** Ignore recovery after a workspace switch or a user prompt resets the retry streak. */
  function isCurrent(): boolean {
    return deps.getBundle() === bundle && deps.getRetries() === attempt && recoveryTokens.get(session) === token;
  }

  /** Read live tools after deferral and report failure only to the originating session. */
  async function recover(): Promise<void> {
    if (!isCurrent()) {
      dbgLog("session", "notifyTruncation deferred call: session or retry changed");
      return;
    }
    try {
      const result = await deps.prompt({
        text: buildTruncationRecoveryHint(session.getActiveToolNames()),
      });
      if (!result.ok && isCurrent()) {
        deps.setStatus("error", `自动恢复未能继续：${result.error}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dbgWarn("session", "notifyTruncation prompt failed", message);
      if (isCurrent()) deps.setStatus("error", `自动恢复失败：${message}`);
    }
  }
  // Defer until after turn_end so the new turn starts cleanly.
  queueMicrotask(() => { void recover(); });
}
