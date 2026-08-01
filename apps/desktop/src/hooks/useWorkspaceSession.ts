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
  ThinkingLevel,
} from "@shared/ipc";
import type { RetractConfirmMode } from "../components/RetractConfirmModal";
import { normalizeProjectKey } from "../lib/group-sessions";
import { createEmptyState, type ChatItem } from "../stores/chat-store";
import {
  clearSessionUsage,
  setSessionUsage,
} from "../stores/session-usage-store";

function applyTheme(themeId: ClientPrefs["themeId"], colorMode: ClientPrefs["colorMode"]): void {
  document.body.dataset.theme = `${themeId}-${colorMode}`;
}

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
  setPrefsRecovery: Dispatch<SetStateAction<PrefsRecoveryNotice | null>>;
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
    setQueuedSteering,
    setEditingEntryId,
    setEditDraft,
    setInput,
    setConfirmState,
    setFollowNonce,
    setPrefs,
    setPrefsRecovery,
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
    void window.xAgent.getSessionUsage().then((u) => {
      if (gen !== usageFetchGen.current) return;
      if (u) setSessionUsage(u);
      else setSessionUsage(null);
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
      setBusy(true);
      setError(null);
      try {
        const result = await window.xAgent.workspace.open(path);
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
        if (result.warning) setError(result.warning);
        const p = await window.xAgent.getPrefs();
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
      setPrefs,
      setSessionId,
      syncFromHost,
    ],
  );

  const newSession = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.workspace.newSession();
      if (!result.ok) {
        setError(result.error ?? "新建会话失败");
        await syncFromHost();
        return;
      }
      clearComposerEditState();
      setInput("");
      setSessionId(result.sessionId);
      setFollowNonce((n) => n + 1);
      await refreshSessions();
    } finally {
      setBusy(false);
    }
  }, [
    clearComposerEditState,
    refreshSessions,
    setBusy,
    setError,
    setFollowNonce,
    setInput,
    setSessionId,
    syncFromHost,
  ]);

  const resumeSession = useCallback(
    async (path: string) => {
      setBusy(true);
      setError(null);
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
        setFollowNonce((n) => n + 1);
        if (result.warning) setError(result.warning);
        const p = await window.xAgent.getPrefs();
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
      setPrefs,
      setSessionId,
      syncFromHost,
    ],
  );

  const deleteSession = useCallback(
    async (path: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await window.xAgent.workspace.deleteSession(path);
        if (!result.ok) {
          setError(result.error ?? "删除失败");
          return;
        }
        await syncFromHost();
        await refreshSessions();
      } finally {
        setBusy(false);
      }
    },
    [refreshSessions, setBusy, setError, syncFromHost],
  );

  const deleteProjectSessions = useCallback(
    async (projectCwd: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await window.xAgent.workspace.deleteProjectSessions(projectCwd);
        if (!result.ok) {
          setError(result.error ?? "删除项目对话失败");
          return;
        }
        await syncFromHost();
        await refreshSessions();
      } finally {
        setBusy(false);
      }
    },
    [refreshSessions, setBusy, setError, syncFromHost],
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
        const next = await window.xAgent.setPrefs({
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
        const [p, recovery] = await Promise.all([
          window.xAgent.getPrefs(),
          window.xAgent.getPrefsRecoveryNotice(),
        ]);
        if (cancelled) return;
        setPrefs(p);
        if (recovery) setPrefsRecovery(recovery);
        applyTheme(p.themeId, p.colorMode);
        setBash(await window.xAgent.checkBash());
        setGit(await window.xAgent.checkGit());
        setAuth(await window.xAgent.checkAuth());
        setPiCli(await window.xAgent.checkPiCli());
        if (cancelled) return;
        await refreshModels();
        if (cancelled) return;
        await refreshSessions();
        if (cancelled) return;

        let restored = false;
        if (p.lastSessionPath) {
          const result = await window.xAgent.workspace.resume(p.lastSessionPath);
          if (cancelled) return;
          if (result.ok) {
            setCwd(result.cwd);
            setSessionId(result.sessionId);
            restored = true;
            if (result.warning) setError(result.warning);
          }
        }
        if (!restored && p.lastProjectPath) {
          const result = await window.xAgent.workspace.open(p.lastProjectPath);
          if (cancelled) return;
          if (result.ok) {
            setCwd(result.cwd);
            setSessionId(result.sessionId);
            if (result.warning) setError(result.warning);
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
    refreshSessions,
    setAuth,
    setBash,
    setCwd,
    setError,
    setGit,
    setPiCli,
    setPrefs,
    setPrefsRecovery,
    setSessionId,
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
    syncFromHost,
  };
}
