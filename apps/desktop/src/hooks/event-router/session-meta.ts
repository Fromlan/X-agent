/**
 * Event router 子模块: session-meta 协调 —— Issue #61 主题 F C-207.
 *
 * 抽出 `session_info` / `session_title` / `session_mode` / `goal_update`
 * 事件处理, 它们都涉及多个 setter 协调 (cwd / sessionId /
 * sessionType / availableThinkingLevels / prefs / goal / queuedSteering
 * / editingEntryId)。其中 session_info 是最重的, 涉及 8+ setter 联动。
 */
import type {
  AgentSessionMode,
  AgentStatus,
  ClientPrefs,
  GoalInfo,
  ThinkingLevel,
  UiAgentEvent,
} from "@shared/ipc";
import type { SessionType } from "@shared/session-type";
import { clearSessionUsage } from "../../stores/session-usage-store";
import { dbgLog } from "@shared/debug-log";
import { translateError } from "@shared/error-i18n";

export type SessionMetaDeps = {
  setStatus: (status: AgentStatus) => void;
  setError: (error: string | null) => void;
  setCwd: (cwd: string | null) => void;
  setSessionId: (id: string | null) => void;
  sessionIdRef: { current: string | null };
  setSessionType: (type: SessionType) => void;
  setPrefs: (
    prefs:
      | ClientPrefs
      | null
      | ((prev: ClientPrefs | null) => ClientPrefs | null),
  ) => void;
  setAvailableThinkingLevels: (levels: ThinkingLevel[] | null) => void;
  setQueuedSteering: (steering: string[]) => void;
  setSessionMode: (mode: AgentSessionMode) => void;
  setPlanPath: (path: string | null) => void;
  setGoal: (goal: GoalInfo | null) => void;
  refreshSessions: () => Promise<void>;
  usageFetchGen: { current: number };
};

/**
 * 处理单个 event, 调用对应 setter. 返回 `true` 表示消费了事件
 * (调用方应跳过 transcript 应用), `false` 表示与本子模块无关。
 */
export function applySessionMetaEvent(
  event: UiAgentEvent,
  deps: SessionMetaDeps,
): boolean {
  if (event.type === "status") {
    deps.setStatus(event.status);
    if (event.error) deps.setError(translateError(event.error));
    else if (event.status === "idle" || event.status === "streaming") {
      deps.setError(null);
    }
    return true;
  }
  if (event.type === "session_info") {
    dbgLog("renderer", "session_info received", {
      thinkingLevel: event.thinkingLevel,
      availableThinkingLevels: event.availableThinkingLevels,
      model: event.model,
      sessionId: event.sessionId,
    });
    const nextId = event.sessionId || null;
    const prevId = deps.sessionIdRef.current;
    deps.setCwd(event.cwd || null);
    deps.setSessionId(nextId);
    deps.sessionIdRef.current = nextId;
    if (event.sessionType) {
      deps.setSessionType(event.sessionType);
    }
    if (!nextId || prevId !== nextId) {
      deps.usageFetchGen.current += 1;
      clearSessionUsage();
      // D11: 会话切换后清除上一会话残留的排队 steer
      deps.setQueuedSteering([]);
    }
    deps.setAvailableThinkingLevels(
      event.availableThinkingLevels.length > 0
        ? event.availableThinkingLevels
        : null,
    );
    deps.setPrefs((prev) =>
      prev
        ? {
            ...prev,
            provider: event.model?.provider ?? prev.provider,
            model: event.model?.id ?? prev.model,
            thinkingLevel: event.thinkingLevel,
            lastSessionPath: event.sessionPath ?? prev.lastSessionPath,
          }
        : prev,
    );
    return true;
  }
  if (event.type === "session_title") {
    void deps.refreshSessions();
    return true;
  }
  if (event.type === "session_mode") {
    deps.setSessionMode(event.mode);
    deps.setPlanPath(event.planPath);
    return true;
  }
  if (event.type === "goal_update") {
    deps.setGoal(event.goal);
    return true;
  }
  if (event.type === "agent_end" && !event.willRetry) {
    void deps.refreshSessions();
    return true;
  }
  return false;
}
