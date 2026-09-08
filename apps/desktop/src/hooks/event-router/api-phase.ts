/**
 * Event router 子模块: API-phase 跟踪 —— Issue #61 主题 F C-207.
 *
 * 把 useAgentEventRouter 内 `assistant_start` / `text_delta` /
 * `thinking_delta` / `agent_end` / `status` 事件推到 apiStatus 的逻辑
 * 抽成纯函数, 便于单测。
 *
 * 4 个 phase (与原 App.tsx 注释一致):
 * - "thinking"  = assistant_start fired, no token yet (slow upstream)
 * - "receiving" = at least one delta has arrived
 * - "retrying"  = session status flipped to retrying
 * - null        = no turn in flight (idle / error)
 */
import type { UiAgentEvent } from "@shared/ipc";
import type { ApiStatus } from "../useAgentEventRouter";

/**
 * 处理单个 event, 推 apiStatus 变更 (如有). 一次性事件 (delta 等) 由
 * 路由器负责跳过日志, 纯函数内部不再判断。
 *
 * 返回 `true` 表示这个 event 影响了 apiStatus, false 表示不相关。
 */
export function applyApiPhaseEvent(
  event: UiAgentEvent,
  onApiStatus: (status: ApiStatus) => void,
): boolean {
  if (event.type === "assistant_start") {
    onApiStatus({ phase: "thinking", startedAt: Date.now() });
    return true;
  }
  if (event.type === "text_delta" || event.type === "thinking_delta") {
    onApiStatus({ phase: "receiving", startedAt: 0 });
    return true;
  }
  if (event.type === "agent_end") {
    onApiStatus(null);
    return true;
  }
  if (event.type === "status") {
    if (event.status === "retrying") {
      onApiStatus({ phase: "retrying", startedAt: Date.now() });
    } else if (event.status === "idle" || event.status === "error") {
      onApiStatus(null);
    }
    // streaming: 保持当前 phase (Pi 会很快 fire assistant_start)
    return true;
  }
  return false;
}
