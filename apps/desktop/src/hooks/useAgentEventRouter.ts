import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  AgentStatus,
  ClientPrefs,
  UiAgentEvent,
} from "@shared/ipc";
import type { ChatItem } from "../stores/chat-store";
import { applyAgentEvent } from "../stores/chat-store";
import {
  clearSessionUsage,
  setCompacting,
  setSessionUsage,
} from "../stores/session-usage-store";

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
  refreshSessions: () => Promise<void>;
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
    refreshSessions,
  } = deps;

  useEffect(() => {
    return window.xAgent.onEvent((event: UiAgentEvent) => {
      if (event.type === "status") {
        setStatus(event.status);
        if (event.error) setError(event.error);
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
        if (!nextId) {
          usageFetchGen.current += 1;
          clearSessionUsage();
        } else if (prevId !== nextId) {
          usageFetchGen.current += 1;
          clearSessionUsage();
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
    refreshSessions,
    sessionIdRef,
    setCwd,
    setEditingEntryId,
    setError,
    setItems,
    setPrefs,
    setQueuedSteering,
    setSessionId,
    setStatus,
    usageFetchGen,
  ]);
}
