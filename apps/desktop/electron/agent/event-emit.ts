/**
 * Event emission with delta sampling (issue #59 主题 A 提取).
 *
 * Lifted out of SessionHost so the host facade stays focused on
 * "接 Pi 事件 + 路由到子编排器". The delta-sampling + window dispatch
 * is a discrete seam that can live here as a free function.
 */
import type { BrowserWindow } from "electron";
import { dbgLog } from "../../shared/debug-log";
import { IPC_EVENTS } from "../../shared/ipc-channels";
import type { UiAgentEvent } from "../../shared/ipc";

/** Snapshot deps for emitting events. */
export interface EventEmitDeps {
  getWindow(): BrowserWindow | null;
  getTextDeltaCount(): number;
  setTextDeltaCount(n: number): void;
  getThinkingDeltaCount(): number;
  setThinkingDeltaCount(n: number): void;
}

/**
 * Emit a UiAgentEvent to the renderer with delta sampling.
 *
 * Sample noisy delta events so we can still tell "no stream at all" from
 * "stream is happening but the log was filtered" — every 100th delta
 * gets a line, others are skipped.
 *
 * Reset stream counters when a non-delta event arrives — different turns
 * shouldn't share the counter.
 *
 * DEBUG(thinking-switch #30): 详细 payload for 排查 thinking 切换失联。
 * 只在 3 个关键事件上多打一条 — session_info / session_mode / notice。
 */
export function emitEvent(deps: EventEmitDeps, event: UiAgentEvent): void {
  if (event.type === "text_delta") {
    const next = deps.getTextDeltaCount() + 1;
    deps.setTextDeltaCount(next);
    if (next === 1 || next % 100 === 0) {
      dbgLog("emit", "-> text_delta", { n: next, len: event.delta.length });
    }
  } else if (event.type === "thinking_delta") {
    const next = deps.getThinkingDeltaCount() + 1;
    deps.setThinkingDeltaCount(next);
    if (next === 1 || next % 100 === 0) {
      dbgLog("emit", "-> thinking_delta", { n: next, len: event.delta.length });
    }
  } else {
    // Reset stream counters when a non-delta event arrives — different turns
    // shouldn't share the counter.
    if (event.type === "assistant_end" || event.type === "agent_end") {
      deps.setTextDeltaCount(0);
      deps.setThinkingDeltaCount(0);
    }
    // DEBUG(thinking-switch #30): 详细 payload for 排查 thinking 切换失联。
    // 只在 3 个关键事件上多打一条 — session_info / session_mode / notice
    // 任何 status 错误，避免淹没常规流。
    if (
      event.type === "session_info" ||
      event.type === "session_mode" ||
      event.type === "notice"
    ) {
      dbgLog("emit", "->", event.type, event);
    } else {
      dbgLog("emit", "->", event.type);
    }
  }
  const win = deps.getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_EVENTS.agentEvent, event);
  } else {
    dbgLog("emit", "drop (window gone)", event.type);
  }
}
