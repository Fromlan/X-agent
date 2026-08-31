import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  AgentSessionMode,
  AgentStatus,
  AuthStatus,
  BashCheckResult,
  ClientPrefs,
  GitCheckResult,
  GoalInfo,
  PiCliStatus,
  PrefsRecoveryNotice,
  RetractPreview,
  SecretCodecStatus,
  ThinkingLevel,
} from "@shared/ipc";
import type { SessionType } from "@shared/session-type";
import { DEFAULT_SESSION_TYPE } from "@shared/session-type";
import type { RetractConfirmMode } from "../components/RetractConfirmModal";
import { normalizeProjectKey } from "../lib/group-sessions";
import { createEmptyState, type ChatItem } from "../stores/chat-store";
import {
  clearSessionUsage,
  setSessionUsage,
} from "../stores/session-usage-store";

type RetractConfirmState = {
  mode: RetractConfirmMode;
  entryId: string;
  preview: RetractPreview;
  editText?: string;
} | null;

export type UseWorkspaceSessionOpts = {
  setItems: Dispatch<SetStateAction<ChatItem[]>>;
  setStatus: Dispatch<SetStateAction<AgentStatus>>;
  setCwd: Dispatch<SetStateAction<string | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setSessionType: Dispatch<SetStateAction<SessionType>>;
  setSessionMode: Dispatch<SetStateAction<AgentSessionMode>>;
  setPlanPath: Dispatch<SetStateAction<string | null>>;
  setGoal: Dispatch<SetStateAction<GoalInfo | null>>;
  setQueuedSteering: Dispatch<SetStateAction<string[]>>;
  setEditingEntryId: Dispatch<SetStateAction<string | null>>;
  setEditDraft: Dispatch<SetStateAction<string>>;
  setInput: Dispatch<SetStateAction<string>>;
  setConfirmState: Dispatch<SetStateAction<RetractConfirmState>>;
  setFollowNonce: Dispatch<SetStateAction<number>>;
  setPrefs: Dispatch<SetStateAction<ClientPrefs | null>>;
  setAvailableThinkingLevels: Dispatch<SetStateAction<ThinkingLevel[] | null>>;
  setPrefsRecovery: Dispatch<SetStateAction<PrefsRecoveryNotice | null>>;
  setSecretCodec: Dispatch<SetStateAction<SecretCodecStatus | null>>;
  setBash: Dispatch<SetStateAction<BashCheckResult | null>>;
  setGit: Dispatch<SetStateAction<GitCheckResult | null>>;
  setAuth: Dispatch<SetStateAction<AuthStatus | null>>;
  setPiCli: Dispatch<SetStateAction<PiCliStatus | null>>;
  refreshSessions: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshProjectReadiness: (cwd: string | null) => Promise<void>;
  prefs: ClientPrefs | null;
  cwd: string | null;
  sessionIdRef: MutableRefObject<string | null>;
  usageFetchGen: MutableRefObject<number>;
};

export function useWorkspaceSession(opts: UseWorkspaceSessionOpts) {
  const {
    setItems,
    setStatus,
    setCwd,
    setSessionId,
    setError,
    setBusy,
    setSessionType,
    setQueuedSteering,
    setEditingEntryId,
    setEditDraft,
    setInput,
    setConfirmState,
    setFollowNonce,
    setPrefs,
    setAvailableThinkingLevels,
    setPrefsRecovery,
    setSecretCodec,
    setBash,
    setGit,
    setAuth,
    setPiCli,
    refreshSessions,
    refreshModels,
    refreshProjectReadiness,
    prefs,
    cwd,
    sessionIdRef,
    usageFetchGen,
  } = opts;

  const fetchSessionUsage = useCallback(() => {
    const gen = ++usageFetchGen.current;
    void window.xAgent.session.getSessionUsage()
      .then((u) => {
        if (gen !== usageFetchGen.current) return;
        if (u) setSessionUsage(u);
        else setSessionUsage(null);
      })
      .catch(() => {
        // D10: IPC 异常时保持上次快照，避免 unhandled rejection。
      });
  }, [usageFetchGen]);

  const syncFromHost = useCallback(async () => {
    const s = await window.xAgent.workspace.getStatus();
    setStatus(s.status);
    setCwd(s.cwd);
    setSessionId(s.sessionId);
    if (!s.hasSession) {
      setItems(createEmptyState());
      setSessionId(null);
      sessionIdRef.current = null;
      setQueuedSteering([]);
      setEditingEntryId(null);
      setEditDraft("");
      setConfirmState(null);
      usageFetchGen.current += 1;
      clearSessionUsage();
    } else {
      fetchSessionUsage();
    }
    if (s.error) setError(s.error);
    else if (s.status === "idle") setError(null);
    if (s.model) {
      setPrefs((prev) =>
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
    // Sync the model-supported thinking levels (issue #30).
    setAvailableThinkingLevels(
      s.availableThinkingLevels && s.availableThinkingLevels.length > 0
        ? s.availableThinkingLevels
        : null,
    );
  }, [
    fetchSessionUsage,
    sessionIdRef,
    setConfirmState,
    setCwd,
    setEditDraft,
    setEditingEntryId,
    setError,
    setItems,
    setPrefs,
    setAvailableThinkingLevels,
    setQueuedSteering,
    setSessionId,
    setStatus,
    usageFetchGen,
  ]);

  const clearComposerEditState = useCallback(() => {
    setEditingEntryId(null);
    setEditDraft("");
    setConfirmState(null);
  }, [setConfirmState, setEditDraft, setEditingEntryId]);

  const openProject = useCallback(
    async (path?: string) => {
      // TopBar may pass this as onClick; ignore non-string (e.g. MouseEvent).
      const projectPath =
        typeof path === "string" && path.trim() ? path.trim() : undefined;
      setBusy(true);
      setError(null);
      setItems(createEmptyState());
      setQueuedSteering([]);
      try {
        const result = await window.xAgent.workspace.open(projectPath);
        if (!result.ok) {
          if (result.error !== "已取消") {
            setError(result.error ?? "打开失败");
            await syncFromHost();
          }
          return;
        }
        clearComposerEditState();
        setInput("");
        setCwd(result.cwd);
        setSessionId(result.sessionId);
        setSessionType(result.sessionType ?? DEFAULT_SESSION_TYPE);
        if (result.warning) setError(result.warning);
        const p = await window.xAgent.prefs.get();
        setPrefs(p);
        await refreshSessions();
        await refreshProjectReadiness(result.cwd);
      } finally {
        setBusy(false);
      }
    },
    [
      clearComposerEditState,
      refreshProjectReadiness,
      refreshSessions,
      setBusy,
      setCwd,
      setError,
      setInput,
      setItems,
      setPrefs,
      setQueuedSteering,
      setSessionId,
      syncFromHost,
    ],
  );

  const newSession = useCallback(
    async (sessionType: SessionType = "code") => {
      setBusy(true);
      setError(null);
      // Clear immediately — do not wait for history_replace; stale bubbles from
      // the previous session must not linger if host events race with abort.
      setItems(createEmptyState());
      setQueuedSteering([]);
      try {
        const result = await window.xAgent.workspace.newSession(sessionType);
        if (!result.ok) {
          setError(result.error ?? "新建会话失败");
          await syncFromHost();
          return;
        }
        clearComposerEditState();
        setInput("");
        setSessionId(result.sessionId);
        setSessionType(result.sessionType ?? DEFAULT_SESSION_TYPE);
        setFollowNonce((n) => n + 1);
        await refreshSessions();
      } finally {
        setBusy(false);
      }
    },
    [
      clearComposerEditState,
      refreshSessions,
      setBusy,
      setError,
      setFollowNonce,
      setInput,
      setItems,
      setQueuedSteering,
      setSessionId,
      setSessionType,
      syncFromHost,
    ],
  );

  const resumeSession = useCallback(
    async (path: string) => {
      setBusy(true);
      setError(null);
      setItems(createEmptyState());
      setQueuedSteering([]);
      try {
        const result = await window.xAgent.workspace.resume(path);
        if (!result.ok) {
          setError(result.error ?? "恢复会话失败");
          await syncFromHost();
          return;
        }
        clearComposerEditState();
        setInput("");
        setCwd(result.cwd);
        setSessionId(result.sessionId);
        setSessionType(result.sessionType ?? DEFAULT_SESSION_TYPE);
        setFollowNonce((n) => n + 1);
        if (result.warning) setError(result.warning);
        const p = await window.xAgent.prefs.get();
        setPrefs(p);
        await refreshSessions();
      } finally {
        setBusy(false);
      }
    },
    [
      clearComposerEditState,
      refreshSessions,
      setBusy,
      setCwd,
      setError,
      setFollowNonce,
      setInput,
      setItems,
      setPrefs,
      setQueuedSteering,
      setSessionId,
      setSessionType,
      syncFromHost,
    ],
  );

  const deleteSession = useCallback(
    async (path: string) => {
      setBusy(true);
      setError(null);
      try {
        const before = await window.xAgent.workspace.getStatus();
        const deletingActive = before.sessionPath === path;
        const result = await window.xAgent.workspace.deleteSession(path);
        if (!result.ok) {
          setError(result.error ?? "删除失败");
          return;
        }
        if (deletingActive) {
          // Active delete: clear before abort races can re-inject bubbles.
          // Fallback resume (if any) re-fills via history_replace.
          setItems(createEmptyState());
          setQueuedSteering([]);
          setInput("");
          clearComposerEditState();
        }
        await syncFromHost();
        await refreshSessions();
      } finally {
        setBusy(false);
      }
    },
    [
      clearComposerEditState,
      refreshSessions,
      setBusy,
      setError,
      setInput,
      setItems,
      setQueuedSteering,
      syncFromHost,
    ],
  );

  const deleteProjectSessions = useCallback(
    async (projectCwd: string) => {
      setBusy(true);
      setError(null);
      try {
        const before = await window.xAgent.workspace.getStatus();
        const activeInProject =
          Boolean(before.cwd) &&
          normalizeProjectKey(before.cwd ?? "") ===
            normalizeProjectKey(projectCwd);
        const result = await window.xAgent.workspace.deleteProjectSessions(projectCwd);
        if (!result.ok) {
          setError(result.error ?? "删除项目对话失败");
          return;
        }
        if (activeInProject) {
          setItems(createEmptyState());
          setQueuedSteering([]);
          setInput("");
          clearComposerEditState();
        }
        await syncFromHost();
        await refreshSessions();
      } finally {
        setBusy(false);
      }
    },
    [
      clearComposerEditState,
      refreshSessions,
      setBusy,
      setError,
      setInput,
      setItems,
      setQueuedSteering,
      syncFromHost,
    ],
  );

  const closeWorkspace = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const closed = await window.xAgent.workspace.close();
      if (!closed.ok) {
        setError(closed.error ?? "关闭工作区失败");
      }
      await syncFromHost();
      await refreshSessions();
    } finally {
      setBusy(false);
    }
  }, [refreshSessions, setBusy, setError, syncFromHost]);

  const hideProject = useCallback(
    async (projectCwd: string) => {
      if (!prefs) return;
      const key = normalizeProjectKey(projectCwd);
      if (!key) return;
      setBusy(true);
      setError(null);
      try {
        const hidden = new Set(
          (prefs.hiddenProjectKeys ?? []).map((k) => normalizeProjectKey(k)),
        );
        hidden.add(key);
        const next = await window.xAgent.prefs.set({
          hiddenProjectKeys: [...hidden],
        });
        setPrefs(next);

        if (cwd && normalizeProjectKey(cwd) === key) {
          const closed = await window.xAgent.workspace.close();
          if (!closed.ok) {
            setError(closed.error ?? "关闭工作区失败");
          }
          await syncFromHost();
        }
        await refreshSessions();
      } finally {
        setBusy(false);
      }
    },
    [cwd, prefs, refreshSessions, setBusy, setError, setPrefs, syncFromHost],
  );

  const renameSession = useCallback(
    async (path: string, name: string) => {
      const result = await window.xAgent.workspace.renameSession(path, name);
      if (!result.ok) setError(result.error ?? "重命名失败");
      else await refreshSessions();
    },
    [refreshSessions, setError],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, recovery, codec] = await Promise.all([
          window.xAgent.prefs.get(),
          window.xAgent.prefs.getRecoveryNotice(),
          window.xAgent.prefs.getSecretCodecStatus(),
        ]);
        if (cancelled) return;
        setPrefs(p);
        if (recovery) setPrefsRecovery(recovery);
        if (codec) setSecretCodec(codec);
        document.body.dataset.theme = `${p.themeId}-${p.colorMode}`;
        setBash(await window.xAgent.prefs.checkBash());
        setGit(await window.xAgent.prefs.checkGit());
        setAuth(await window.xAgent.prefs.checkAuth());
        setPiCli(await window.xAgent.prefs.checkPiCli());
        if (cancelled) return;
        await refreshModels();
        if (cancelled) return;
        await refreshSessions();
        if (cancelled) return;

        // Always start on a fresh empty chat for the last project — do not
        // resume lastSessionPath (sidebar still lists history for manual open).
        if (p.lastProjectPath) {
          setItems(createEmptyState());
          setQueuedSteering([]);
          const result = await window.xAgent.workspace.open(
            p.lastProjectPath,
            "new",
          );
          if (cancelled) return;
          if (result.ok) {
            setCwd(result.cwd);
            setSessionId(result.sessionId);
            setSessionType(result.sessionType ?? DEFAULT_SESSION_TYPE);
            setFollowNonce((n) => n + 1);
            if (result.warning) setError(result.warning);
            await refreshProjectReadiness(result.cwd);
          } else if (result.error && result.error !== "已取消") {
            setError(result.error);
            await syncFromHost();
          }
        }
        await refreshSessions();
      } finally {
        if (!cancelled) {
          void window.xAgent.notifyAppReady();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    refreshModels,
    refreshProjectReadiness,
    refreshSessions,
    setAuth,
    setBash,
    setCwd,
    setError,
    setFollowNonce,
    setGit,
    setItems,
    setPiCli,
    setPrefs,
    setPrefsRecovery,
    setSecretCodec,
    setQueuedSteering,
    setSessionId,
    setSessionType,
    syncFromHost,
  ]);

  return {
    openProject,
    newSession,
    resumeSession,
    deleteSession,
    deleteProjectSessions,
    closeWorkspace,
    hideProject,
    renameSession,
  };
}
