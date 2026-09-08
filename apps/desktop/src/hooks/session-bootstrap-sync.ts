/**
 * `syncFromHost` —— Issue #61 主题 F (2026-08-31).
 *
 * 把 `window.xAgent.workspace.getStatus()` 的结果同步到 renderer state.
 * 同时被 useSessionBootstrap (启动期打开 last project 失败时回滚) 和
 * useWorkspaceSession.syncFromHost 使用, 避免逻辑双写。
 */
import type {
  AgentStatus,
  ClientPrefs,
  ThinkingLevel,
} from "@shared/ipc";
import type { MutableRefObject } from "react";
import type { ChatItem } from "../stores/chat-store";
import { createEmptyState } from "../stores/chat-store";
import {
  clearSessionUsage,
  setSessionUsage,
} from "../stores/session-usage-store";

export type SyncFromHostOpts = {
  setStatus: (status: AgentStatus) => void;
  setCwd: (cwd: string | null) => void;
  setSessionId: (id: string | null) => void;
  sessionIdRef: MutableRefObject<string | null>;
  setItems: (items: ChatItem[] | ((prev: ChatItem[]) => ChatItem[])) => void;
  setQueuedSteering: (steering: string[]) => void;
  setEditingEntryId: (id: string | null) => void;
  setEditDraft: (text: string) => void;
  setConfirmState: (s: unknown) => void;
  setError: (error: string | null) => void;
  setPrefs: (
    prefs:
      | ClientPrefs
      | null
      | ((prev: ClientPrefs | null) => ClientPrefs | null),
  ) => void;
  setAvailableThinkingLevels: (levels: ThinkingLevel[] | null) => void;
  usageFetchGen: MutableRefObject<number>;
  /** useWorkspaceSession 内部的 fetchSessionUsage, hasSession=true 时调 */
  fetchSessionUsage: () => void;
};

/**
 * 把 `window.xAgent.workspace.getStatus()` 的结果同步到 renderer state.
 *
 * 1) hasSession=false: 清空 items / queuedSteering / editingEntryId /
 *    editDraft / confirmState; bump usageFetchGen, 清 usage store.
 * 2) hasSession=true: fetch usage.
 * 3) error: setError; idle: setError(null).
 * 4) model 同步到 prefs (provider / model / thinkingLevel)。
 * 5) availableThinkingLevels 同步到 Composer (issue #30)。
 */
export async function syncFromHost(opts: SyncFromHostOpts): Promise<void> {
  const s = await window.xAgent.workspace.getStatus();
  opts.setStatus(s.status);
  opts.setCwd(s.cwd);
  opts.setSessionId(s.sessionId);
  if (!s.hasSession) {
    opts.setItems(createEmptyState());
    opts.setSessionId(null);
    opts.sessionIdRef.current = null;
    opts.setQueuedSteering([]);
    opts.setEditingEntryId(null);
    opts.setEditDraft("");
    opts.setConfirmState(null);
    opts.usageFetchGen.current += 1;
    clearSessionUsage();
  } else {
    opts.fetchSessionUsage();
  }
  if (s.error) opts.setError(s.error);
  else if (s.status === "idle") opts.setError(null);
  if (s.model) {
    opts.setPrefs((prev) =>
      prev
        ? {
            ...prev,
            provider: s.model?.provider ?? prev.provider,
            model: s.model?.id ?? prev.model,
            thinkingLevel: s.thinkingLevel as ThinkingLevel,
          }
        : prev,
    );
  }
  opts.setAvailableThinkingLevels(
    s.availableThinkingLevels && s.availableThinkingLevels.length > 0
      ? s.availableThinkingLevels
      : null,
  );
}
