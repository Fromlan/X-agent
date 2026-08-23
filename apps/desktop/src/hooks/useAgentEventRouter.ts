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
  UiAgentEvent,
} from "@shared/ipc";
import type { GameStage } from "@shared/game-stage";
import type { ChatItem } from "../stores/chat-store";
import { applyAgentEvent } from "../stores/chat-store";
import {
  clearSessionUsage,
  setCompacting,
  setSessionUsage,
} from "../stores/session-usage-store";
import { dbgLog } from "@shared/debug-log";
import { translateError } from "@shared/error-i18n";

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
  sessionIdRef: MutableRefObject<string | null>;
  usageFetchGen: MutableRefObject<number>;
  setPrefs: Dispatch<SetStateAction<ClientPrefs | null>>;
  setQueuedSteering: Dispatch<SetStateAction<string[]>>;
  setEditingEntryId: Dispatch<SetStateAction<string | null>>;
  setItems: Dispatch<SetStateAction<ChatItem[]>>;
  setSessionMode: Dispatch<SetStateAction<AgentSessionMode>>;
  setGameStage: Dispatch<SetStateAction<GameStage | null>>;
  setPlanPath: Dispatch<SetStateAction<string | null>>;
  setGoal: Dispatch<SetStateAction<GoalInfo | null>>;
  refreshSessions: () => Promise<void>;
  /** Live API phase for the composer's status line. Ref-captured to keep effect stable. */
  onApiStatus?: MutableRefObject<(status: ApiStatus) => void>;
};

/**
 * Demux main-process UiAgentEvent into App state.
 * Transcript items go through chat-store; status/usage/title are side channels.
 */
export function useAgentEventRouter(deps: EventRouterDeps): void {
  const {
    setStatus,
    setError,
    setCwd,
    setSessionId,
    sessionIdRef,
    usageFetchGen,
    setPrefs,
    setQueuedSteering,
    setEditingEntryId,
    setItems,
    setSessionMode,
    setGameStage,
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
      // --- API-phase tracking ---------------------------------------------
      // "thinking"  = assistant_start fired, no token yet (slow upstream)
      // "receiving" = at least one delta has arrived
      // "retrying"  = session status flipped to retrying
      // null        = no turn in flight (idle / error)
      if (event.type === "assistant_start") {
        push({ phase: "thinking", startedAt: Date.now() });
      } else if (event.type === "text_delta" || event.type === "thinking_delta") {
        push({ phase: "receiving", startedAt: 0 });
      } else if (event.type === "agent_end") {
        push(null);
      } else if (event.type === "status") {
        if (event.status === "retrying") {
          push({ phase: "retrying", startedAt: Date.now() });
        } else if (event.status === "idle" || event.status === "error") {
          push(null);
        }
        // streaming: keep current phase (Pi will fire assistant_start soon)
      }
      if (event.type === "status") {
        setStatus(event.status);
        if (event.error) setError(translateError(event.error));
        else if (event.status === "idle" || event.status === "streaming") {
          setError(null);
        }
        return;
      }
      if (event.type === "session_info") {
        const nextId = event.sessionId || null;
        const prevId = sessionIdRef.current;
        setCwd(event.cwd || null);
        setSessionId(nextId);
        sessionIdRef.current = nextId;
        if (!nextId || prevId !== nextId) {
          usageFetchGen.current += 1;
          clearSessionUsage();
          // D11: 会话切换后清除上一会话残留的排队 steer（主进程不会对
          // 新会话补发 queue_update([])，banner 会显示过期内容）。
          setQueuedSteering([]);
        }
        setPrefs((prev) =>
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
        return;
      }
      if (event.type === "session_title") {
        void refreshSessions();
        return;
      }
      if (event.type === "game_stage") {
        setGameStage(event.info?.stage ?? null);
        return;
      }
      if (event.type === "session_mode") {
        setSessionMode(event.mode);
        setPlanPath(event.planPath);
        return;
      }
      if (event.type === "goal_update") {
        setGoal(event.goal);
        return;
      }
      if (event.type === "agent_end" && !event.willRetry) {
        void refreshSessions();
      }
      if (event.type === "usage_update") {
        setSessionUsage(event.usage);
        return;
      }
      if (event.type === "compaction_start") {
        setCompacting(true);
        return;
      }
      if (event.type === "compaction_end") {
        setCompacting(false);
        return;
      }
      if (event.type === "queue_update") {
        setQueuedSteering(event.steering);
        return;
      }
      if (event.type === "history_replace") {
        // Do not clear queuedSteering here — queue_update owns that snapshot.
        setEditingEntryId((id) => {
          if (!id) return null;
          const stillThere = event.items.some(
            (it) =>
              it.kind === "user" && (it.entryId === id || it.id === id),
          );
          return stillThere ? id : null;
        });
      }
      setItems((prev) => applyAgentEvent(prev, event));
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
    setGameStage,
    setStatus,
    usageFetchGen,
  ]);
}
