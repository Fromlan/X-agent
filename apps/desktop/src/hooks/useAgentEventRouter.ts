import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  AgentSessionMode,
  AgentStatus,
  ClientPrefs,
  GoalInfo,
  ThinkingLevel,
  UiAgentEvent,
} from "@shared/ipc";
import type { SessionType } from "@shared/session-type";
import type { ChatItem } from "../stores/chat-store";
import { dbgLog } from "@shared/debug-log";
import { applyApiPhaseEvent } from "./event-router/api-phase";
import { applySessionMetaEvent } from "./event-router/session-meta";
import { applyTranscriptEvent } from "./event-router/transcript";
import { applyUsageEvent } from "./event-router/usage";

/** What UI shows in the "API status" line beneath the chat input. */
export type ApiPhase = "thinking" | "receiving" | "retrying";
export type ApiStatus = {
  phase: ApiPhase;
  /** Epoch ms when this phase started; null when phase is receiving (stream already flowing). */
  startedAt: number;
} | null;

type EventRouterDeps = {
  setStatus: Dispatch<SetStateAction<AgentStatus>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setCwd: Dispatch<SetStateAction<string | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setSessionType: Dispatch<SetStateAction<SessionType>>;
  sessionIdRef: MutableRefObject<string | null>;
  usageFetchGen: MutableRefObject<number>;
  setPrefs: Dispatch<SetStateAction<ClientPrefs | null>>;
  /**
   * Thinking levels supported by the current session's model. Driven by
   * `session_info` events (Pi `getAvailableThinkingLevels()`). `null` while
   * no session is open — Composer falls back to all THINKING_LEVELS.
   * See issue #30.
   */
  setAvailableThinkingLevels: Dispatch<SetStateAction<ThinkingLevel[] | null>>;
  setQueuedSteering: Dispatch<SetStateAction<string[]>>;
  setEditingEntryId: Dispatch<SetStateAction<string | null>>;
  setItems: Dispatch<SetStateAction<ChatItem[]>>;
  setSessionMode: Dispatch<SetStateAction<AgentSessionMode>>;
  setPlanPath: Dispatch<SetStateAction<string | null>>;
  setGoal: Dispatch<SetStateAction<GoalInfo | null>>;
  refreshSessions: () => Promise<void>;
  /** Live API phase for the composer's status line. Ref-captured to keep effect stable. */
  onApiStatus?: MutableRefObject<(status: ApiStatus) => void>;
};

/**
 * Demux main-process UiAgentEvent into App state.
 *
 * 实现 (issue #61 主题 F C-207): 主体只剩一行 `for` 循环 (调 4 个
 * 子模块), 每个子模块自带单测覆盖, 主体不再塞具体业务逻辑。
 */
export function useAgentEventRouter(deps: EventRouterDeps): void {
  const {
    setStatus,
    setError,
    setCwd,
    setSessionId,
    setSessionType,
    sessionIdRef,
    usageFetchGen,
    setPrefs,
    setAvailableThinkingLevels,
    setQueuedSteering,
    setEditingEntryId,
    setItems,
    setSessionMode,
    setPlanPath,
    setGoal,
    refreshSessions,
    onApiStatus,
  } = deps;

  useEffect(() => {
    // Local helper to push API-phase changes through the ref-captured callback.
    const push = (status: ApiStatus) => {
      onApiStatus?.current(status);
    };
    return window.xAgent.onEvent((event: UiAgentEvent) => {
      // Skip noisy delta events — they would flood the console during streaming.
      if (event.type !== "text_delta" && event.type !== "thinking_delta") {
        dbgLog("chat", "onEvent", event.type);
      }

      // API phase 跟踪 —— 改 ref-captured callback, 其它都不动
      applyApiPhaseEvent(event, push);

      // session-meta 协调 (status / session_info / session_title /
      // session_mode / goal_update / agent_end 副作用)
      if (applySessionMetaEvent(event, {
        setStatus,
        setError,
        setCwd,
        setSessionId,
        sessionIdRef,
        setSessionType,
        setPrefs,
        setAvailableThinkingLevels,
        setQueuedSteering,
        setSessionMode,
        setPlanPath,
        setGoal,
        refreshSessions,
        usageFetchGen,
      })) {
        return;
      }

      // usage / compaction / queue 跟踪 —— 落到 session-usage-store
      if (applyUsageEvent(event, { setQueuedSteering })) {
        return;
      }

      // transcript 应用 (chat-store reducer + history_replace editingEntryId 清理)
      applyTranscriptEvent(event, { setItems, setEditingEntryId });
    });
  }, [
    onApiStatus,
    refreshSessions,
    sessionIdRef,
    setCwd,
    setEditingEntryId,
    setError,
    setGoal,
    setItems,
    setPlanPath,
    setPrefs,
    setQueuedSteering,
    setSessionId,
    setSessionMode,
    setSessionType,
    setStatus,
    usageFetchGen,
  ]);
}
