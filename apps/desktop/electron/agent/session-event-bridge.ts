/**
 * Wires Pi's AgentSession event stream to X-agent's UiAgentEvent stream.
 * Extracted from SessionHost.bridgeEvents so the (large) switch statement
 * can be read/tested independently of the rest of the host's state machine.
 *
 * Deps are grouped into turn / usage facets so the seam stays small while
 * SessionHost still provides the adapters.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentStatus, TurnUsage, UiAgentEvent } from "../../shared/ipc";
import {
  TRANSCRIPT_CAPS,
  extractMessageText,
  truncateTranscript,
} from "../../shared/transcript";
import { modelUsageKey, recordTurnUsage } from "./usage-store";
import { dbgWarn } from "../../shared/debug-log";
import type { TurnFileTracker } from "./turn-file-tracker";
import type { ShadowCheckpointTracker } from "./shadow-checkpoints";
import {
  serializeForDetail,
  turnUsageFromMessage,
  type ToolDetailRecord,
} from "./session-host-helpers";

/** Turn binding + checkpoint trackers (撤回撤销 capture path). */
export interface SessionEventTurnFacet {
  fileTracker: TurnFileTracker;
  shadowCheckpoints: ShadowCheckpointTracker;
  currentUserEntryId(): string | undefined;
}

/** Usage / compaction recording for the live session. */
export interface SessionEventUsageFacet {
  setLastTurnUsage(usage: TurnUsage | undefined): void;
  isCompactionRecording(): boolean;
  setCompactionRecording(value: boolean): void;
  captureCompactionBaseline(): void;
  recordCompactionDelta(): void;
  clearCompactionBaseline(): void;
}

/**
 * Narrow seam for the event bridge. Callers learn emit + turn + usage + hooks,
 * not a flat bag of ~20 peer callbacks.
 */
export interface SessionEventBridgeDeps {
  emit(event: UiAgentEvent): void;
  setStatus(status: AgentStatus, error?: string): void;
  /** Sets the last-error field without emitting a status event. */
  setLastErrorSilently(error: string): void;
  emitUsageUpdate(): void;
  emitHistoryReplace(): void;
  messageIdFrom(message: unknown): string;
  toolDetails: Map<string, ToolDetailRecord>;
  /** Current bundle's session, or null if no project is open. */
  getSession(): AgentSession | null;
  turn: SessionEventTurnFacet;
  usage: SessionEventUsageFacet;
  maybeAutoTitleSession(): Promise<void>;
  /**
   * Called on `turn_end` and periodically on `tool_execution_end` to run
   * the snip-first + auto-compact pass. The host owns debounce / lock so
   * the bridge just schedules; the call returns a promise that may be
   * long-lived when compaction is needed. Errors are logged inside.
   */
  autoMaintainIfNeeded(): Promise<void> | void;
  /** Called after agent_end when not retrying — Goal Mode continuation hook. */
  onAgentSettled?: () => void;
  /**
   * Called when an assistant message ends with `stopReason: "length"` AND the
   * content has no text / no tool call (only thinking). The host decides whether
   * to inject a system-recovery prompt up to a per-session cap.
   *
   * Root cause: M3 + thinking_level=max has no thinking budget cap, so the
   * 16K output ceiling can be fully consumed by thinking, leaving zero tokens
   * for any visible response. The host treats this as a recovery-worthy
   * truncation and re-prompts with a no-think-this-turn hint.
   */
  notifyTruncation?(detail: { messageId: string; outputTokens: number }): void;
}

/**
 * Pi persists user messages on message_end *after* notifying listeners, so
 * getLeafEntry() is still the previous user during message_start/message_end.
 * Bind active turn only after append (microtask) or at tool_execution_start.
 */
function bindActiveUserTurn(deps: SessionEventBridgeDeps): string | undefined {
  const entryId = deps.turn.currentUserEntryId();
  if (!entryId) return undefined;
  const { fileTracker, shadowCheckpoints } = deps.turn;
  if (fileTracker.getActiveUserEntryId() !== entryId) {
    fileTracker.setActiveUserEntryId(entryId);
    shadowCheckpoints.bindPendingPre(entryId);
    const sess = deps.getSession();
    if (sess) {
      shadowCheckpoints.persistDirty(sess.sessionManager);
    }
  } else if (!shadowCheckpoints.getCheckpoint(entryId)?.pre) {
    // Same turn already active but pre not bound yet (pending SHA arrived late).
    shadowCheckpoints.bindPendingPre(entryId);
    const sess = deps.getSession();
    if (sess) {
      shadowCheckpoints.persistDirty(sess.sessionManager);
    }
  }
  return entryId;
}

/**
 * True iff the assistant message was truncated by `max_tokens` and contains
 * no actionable content (only thinking). Exported so tests can lock the rule
 * without a full Pi event stream. Uses weak typing on purpose — the message
 * shape from Pi may shift across SDK releases; null guards are defensive.
 */
export function isTruncatedThinkingOnly(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const m = message as { stopReason?: unknown; content?: unknown };
  if (m.stopReason !== "length") return false;
  if (!Array.isArray(m.content)) return false;
  for (const part of m.content) {
    if (!part || typeof part !== "object") continue;
    const t = (part as { type?: unknown }).type;
    if (t === "text" || t === "toolCall") return false;
  }
  // length + no text + no toolCall + content array exists → truncation-only
  return true;
}

/** Subscribes to `session`'s Pi events and forwards them via `deps`. Returns the unsubscribe function. */
export function bridgeSessionEvents(
  session: AgentSession,
  deps: SessionEventBridgeDeps,
): () => void {
  // Mid-turn auto-maintain counter: every 5 tool executions within a single
  // turn nudges the host to re-evaluate the snip / compact threshold. Reset
  // to 0 on `turn_start` so each turn gets its own cadence.
  let midTurnToolCount = 0;
  return session.subscribe((event) => {
    // Drop events after the host switched (or cleared) the active bundle.
    // Otherwise abort/turn_end from a disposed session can re-inject bubbles
    // into a brand-new empty chat (delete → 新对话 leak).
    if (deps.getSession() !== session) return;
    switch (event.type) {
      case "agent_start":
        deps.setStatus("streaming");
        deps.emit({ type: "agent_start" });
        break;
      case "agent_end": {
        const willRetry = Boolean(
          (event as { willRetry?: boolean }).willRetry,
        );
        if (willRetry) {
          deps.setStatus("retrying");
        } else {
          deps.setStatus("idle");
          void deps.maybeAutoTitleSession();
          deps.onAgentSettled?.();
        }
        deps.emit({ type: "agent_end", willRetry });
        deps.emitUsageUpdate();
        break;
      }
      case "turn_start":
        midTurnToolCount = 0;
        deps.emit({ type: "turn_start" });
        break;
      case "turn_end": {
        const currentSession = deps.getSession();
        // Persist may have landed after message_end; bind before post snapshot.
        const activeUid =
          bindActiveUserTurn(deps) ??
          deps.turn.fileTracker.getActiveUserEntryId();
        if (currentSession && activeUid) {
          void deps.turn.shadowCheckpoints.capturePost(activeUid).then(
            async () => {
              deps.turn.shadowCheckpoints.persistDirty(
                currentSession.sessionManager,
              );
              // 回合 diff：优先 Shadow pre→post（覆盖 bash 等全部改动）；
              // Shadow 不可用（无 Git / steer 无 pre）时降级为 write/edit
              // 基线内容对比——bash 副作用在无 Git 时本就无法追踪。
              const turnDiff =
                (await deps.turn.shadowCheckpoints.diffForTurn(activeUid)) ??
                deps.turn.fileTracker.diffTextForTurn(activeUid);
              if (turnDiff && turnDiff.diffText && turnDiff.paths.length > 0) {
                deps.emit({
                  type: "turn_diff",
                  userEntryId: activeUid,
                  paths: turnDiff.paths,
                  diffText: turnDiff.diffText,
                  ...(turnDiff.truncated ? { truncated: true } : {}),
                });
              }
            },
          );
        }
        if (currentSession) {
          deps.turn.fileTracker.persistDirty(currentSession.sessionManager);
        }
        deps.emit({ type: "turn_end" });
        deps.emitHistoryReplace();
        deps.emitUsageUpdate();
        // Auto-maintain (snip-first, then compact if still over) runs after
        // the turn ends so a long single-turn can recover without waiting
        // for agent_end. The call is fire-and-forget: errors / busy states
        // are swallowed inside `autoMaintainIfNeeded`.
        void deps.autoMaintainIfNeeded();
        break;
      }
      case "message_start": {
        const msg = event.message as {
          role?: string;
          stopReason?: string;
          errorMessage?: string;
        };
        if (msg.role === "assistant") {
          // Prefer already-bound id; fall back to leaf (user should be persisted by now).
          const userEntryId =
            deps.turn.fileTracker.getActiveUserEntryId() ??
            bindActiveUserTurn(deps) ??
            undefined;
          deps.emit({
            type: "assistant_start",
            messageId: deps.messageIdFrom(event.message),
            ...(userEntryId ? { userEntryId } : {}),
          });
        } else if (msg.role === "user") {
          const text = extractMessageText(event.message);
          if (text) {
            // Do NOT bind active turn here: sessionManager has not appended yet,
            // so currentUserEntryId() is the previous user (or undefined).
            deps.emit({
              type: "user_message",
              text,
              id: deps.messageIdFrom(event.message),
            });
          }
        }
        break;
      }
      case "message_update": {
        const ame = event.assistantMessageEvent as {
          type?: string;
          delta?: string;
        };
        const id = deps.messageIdFrom(event.message);
        if (ame?.type === "text_delta" && ame.delta) {
          deps.emit({ type: "text_delta", messageId: id, delta: ame.delta });
        } else if (ame?.type === "thinking_delta" && ame.delta) {
          deps.emit({
            type: "thinking_delta",
            messageId: id,
            delta: ame.delta,
          });
        }
        break;
      }
      case "message_end": {
        const msg = event.message as {
          role?: string;
          stopReason?: string;
          errorMessage?: string;
          usage?: unknown;
        };
        if (msg.role === "user") {
          // 关键时序（AGENTS.md）：Pi 在 message_end 的 listeners 返回之后才
          // appendMessage —— 此处 active user / Shadow pre 必须在 append 之后
          // 绑定，因此用 queueMicrotask 推到同一 tick 的微任务（append 已同步
          // 完成）再 bindActiveUserTurn；不能在 message_start 取 leaf。
          // 若 Pi 的 appendMessage 改为异步落盘，此绑定可能拿到上一 uid，
          // bindPendingPre 会走 existing.pre 分支丢弃新 pre（无工具回合时
          // 不自行恢复）——升级 Pi SDK 时需回归 test-session-bind-timing。
          queueMicrotask(() => {
            bindActiveUserTurn(deps);
          });
        } else if (msg.role === "assistant") {
          const isError =
            msg.stopReason === "error" || Boolean(msg.errorMessage);
          const isAborted = msg.stopReason === "aborted";
          const turnUsage =
            !isError && !isAborted
              ? turnUsageFromMessage(event.message)
              : null;
          if (turnUsage) {
            deps.usage.setLastTurnUsage(turnUsage);
            const model = deps.getSession()?.model;
            if (model && !deps.usage.isCompactionRecording()) {
              // recordTurnUsage 改为 async (写盘走 atomic rename + 串行队列)。
              // event-bridge 是 sync callback,fire-and-forget + 错误走 dbgWarn。
              void recordTurnUsage(
                modelUsageKey(model.provider, model.id),
                turnUsage,
              ).catch((err) => {
                const message = err instanceof Error ? err.message : String(err);
                dbgWarn("usage", "recordTurnUsage failed", message);
              });
            }
          }
          deps.emit({
            type: "assistant_end",
            messageId: deps.messageIdFrom(event.message),
            isError,
            errorMessage: msg.errorMessage,
            ...(turnUsage ? { usage: turnUsage } : {}),
          });
          if (isError && msg.errorMessage) {
            deps.setStatus("error", msg.errorMessage);
          }
          // M3 + thinking_level=max 撞墙:output 配额全花光在 thinking,
          // 留下零 text / 零 tool_call。让 host 决定是否 inject 恢复 prompt。
          if (!isError && !isAborted && deps.notifyTruncation) {
            const assistantMsg = event.message as {
              content?: Array<{ type?: string }>;
              usage?: { output?: number };
            };
            if (isTruncatedThinkingOnly(assistantMsg)) {
              deps.notifyTruncation({
                messageId: deps.messageIdFrom(event.message),
                outputTokens: Number(assistantMsg.usage?.output ?? 0),
              });
            }
          }
        }
        break;
      }
      case "tool_execution_start": {
        // User message is persisted by now; bind before capturing baselines.
        bindActiveUserTurn(deps);
        deps.turn.fileTracker.captureBeforeTool(event.toolName, event.args);
        const argsPack = serializeForDetail(event.args);
        deps.toolDetails.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: argsPack.value,
          done: false,
          truncated: argsPack.truncated,
        });
        deps.emit({
          type: "tool_start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: truncateTranscript(event.args, TRANSCRIPT_CAPS.streamTool),
        });
        break;
      }
      case "tool_execution_update": {
        const prev = deps.toolDetails.get(event.toolCallId);
        if (prev) {
          const pack = serializeForDetail(event.partialResult);
          deps.toolDetails.set(event.toolCallId, {
            ...prev,
            result: pack.value,
            truncated: prev.truncated || pack.truncated,
          });
        }
        deps.emit({
          type: "tool_update",
          toolCallId: event.toolCallId,
          partialResult: truncateTranscript(
            event.partialResult,
            TRANSCRIPT_CAPS.streamTool,
          ),
        });
        break;
      }
      case "tool_execution_end": {
        const prevDetail = deps.toolDetails.get(event.toolCallId);
        const argsPack = serializeForDetail(prevDetail?.args);
        const resultPack = serializeForDetail(event.result);
        deps.toolDetails.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: argsPack.value,
          result: resultPack.value,
          isError: event.isError,
          done: true,
          truncated: Boolean(prevDetail?.truncated) || resultPack.truncated,
        });
        deps.emit({
          type: "tool_end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: truncateTranscript(
            event.result,
            TRANSCRIPT_CAPS.streamToolResult,
          ),
          isError: event.isError,
        });
        // Mid-turn auto-maintain: every 5th tool execution nudges the host to
        // re-evaluate. `autoMaintainIfNeeded` itself debounces (5s) and exits
        // early when below threshold, so this stays cheap.
        midTurnToolCount += 1;
        if (midTurnToolCount >= 5) {
          midTurnToolCount = 0;
          void deps.autoMaintainIfNeeded();
        }
        break;
      }
      case "queue_update":
        deps.emit({
          type: "queue_update",
          steering: [...(event.steering ?? [])],
          followUp: [...(event.followUp ?? [])],
        });
        break;
      case "auto_retry_start":
        deps.setStatus("retrying");
        deps.emit({
          type: "auto_retry",
          phase: "start",
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          message: event.errorMessage,
        });
        break;
      case "auto_retry_end":
        deps.setStatus(event.success ? "streaming" : "error");
        if (!event.success && event.finalError) {
          deps.setLastErrorSilently(event.finalError);
        }
        deps.emit({
          type: "auto_retry",
          phase: "end",
          attempt: event.attempt,
          success: event.success,
          message: event.finalError,
        });
        break;
      case "compaction_start":
        deps.usage.setCompactionRecording(true);
        deps.usage.captureCompactionBaseline();
        deps.emit({
          type: "compaction_start",
          reason: event.reason,
        });
        break;
      case "compaction_end": {
        const result = event.result as
          | { tokensBefore?: number; estimatedTokensAfter?: number }
          | undefined;
        if (!event.aborted) {
          deps.usage.recordCompactionDelta();
        } else {
          deps.usage.clearCompactionBaseline();
        }
        deps.usage.setCompactionRecording(false);
        deps.emit({
          type: "compaction_end",
          reason: event.reason,
          aborted: event.aborted,
          errorMessage: event.errorMessage,
          ...(result?.tokensBefore != null
            ? { tokensBefore: result.tokensBefore }
            : {}),
          ...(result?.estimatedTokensAfter != null
            ? { estimatedTokensAfter: result.estimatedTokensAfter }
            : {}),
        });
        deps.emitHistoryReplace();
        deps.emitUsageUpdate();
        break;
      }
      default:
        break;
    }
  });
}
