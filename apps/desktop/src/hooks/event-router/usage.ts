/**
 * Event router 子模块: usage / compaction / queue 跟踪 —— Issue #61 主题 F C-207.
 *
 * 抽出 `usage_update` / `compaction_start` / `compaction_end` /
 * `queue_update` 事件的副作用, 它们都直接落到 session-usage-store
 * 或上层 setter, 不需要再协调。
 */
import type { UiAgentEvent } from "@shared/ipc";
import {
  setCompacting,
  setSessionUsage,
} from "../../stores/session-usage-store";

export type UsageSideEffects = {
  /** session-usage-store 的 setter —— already imported by caller */
  // (直接调用 setSessionUsage / setCompacting)
  /** queue_update → setQueuedSteering */
  setQueuedSteering: (steering: string[]) => void;
};

export function applyUsageEvent(
  event: UiAgentEvent,
  fx: UsageSideEffects,
): boolean {
  if (event.type === "usage_update") {
    setSessionUsage(event.usage);
    return true;
  }
  if (event.type === "compaction_start") {
    setCompacting(true);
    return true;
  }
  if (event.type === "compaction_end") {
    setCompacting(false);
    return true;
  }
  if (event.type === "queue_update") {
    fx.setQueuedSteering(event.steering);
    return true;
  }
  return false;
}
