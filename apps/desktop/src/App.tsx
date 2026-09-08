import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  AgentSessionMode,
  AgentStatus,
  AuthStatus,
  BashCheckResult,
  ClientPrefs,
  GitCheckResult,
  GoalInfo,
  ModelInfo,
  PiCliStatus,
  PrefsRecoveryNotice,
  SecretCodecStatus,
  SessionInfo,
  ThinkingLevel,
} from "@shared/ipc";
import { DEFAULT_SESSION_TYPE, type SessionType } from "@shared/session-type";
import { AppBanners } from "./components/AppBanners";
import { AppMainRow } from "./components/AppMainRow";
import { AppSettingsPanel } from "./components/AppSettingsPanel";
import { type SettingsTabTarget } from "./components/ReadyChecklist";
import { RetractConfirmModal } from "./components/RetractConfirmModal";
import { TopBar } from "./components/TopBar";
import { openToolInRightPanel } from "./components/RightPanel";
import type { SettingsTab } from "./components/SettingsPanel";
import {
  appendAtPath,
  collapseFileBlocksToAtPaths,
} from "./lib/expandAtPaths";
import { startersForProject } from "./lib/chat-starters";
import { useAgentEventRouter } from "./hooks/useAgentEventRouter";
import { useAutoCompact } from "./hooks/useAutoCompact";
import { useAppActions } from "./hooks/useAppActions";
import { useAppLayout } from "./hooks/useAppLayout";
import { useComposer } from "./hooks/useComposer";
import { useGoalMode, type GoalModeApi } from "./hooks/useGoalMode";
import { usePlanSessionAutoOpen } from "./hooks/usePlanSession";
import { useProjectReadiness } from "./hooks/useProjectReadiness";
import { useRetractConfirm } from "./hooks/useRetractConfirm";
import { useSessionBootstrap } from "./hooks/useSessionBootstrap";
import { useWorkspaceSession } from "./hooks/useWorkspaceSession";
import { useScrollElevated } from "./hooks/useScrollElevated";
import { useLogo } from "./hooks/useLogo";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { createEmptyState, type ChatItem } from "./stores/chat-store";
import {
  getCompacting,
  getSessionUsageState,
  getSessionUsageStoreVersion,
  subscribeSessionUsageStore,
} from "./stores/session-usage-store";

/**
 * App 顶层 —— composition root (主题 F C-201).
 *
 * App.tsx 从 1319 行降到 < 500 行, 只剩:
 * 1) 顶层 state 声明
 * 2) 9 个 hook 调用 (useGoalMode / useComposer / useSessionBootstrap /
 *    useAgentEventRouter / useRetractConfirm / useProjectReadiness /
 *    useWorkspaceSession / useAppActions / useAppLayout) 注入 setter
 * 3) 4 个业务 callback (onBuildPlan / onCycleSessionMode / addPathToChat /
 *    pickStarter) 和 edit-related 4 个 useCallback
 * 4) JSX: <TopBar> + <AppBanners> + <AppMainRow> + <RetractConfirmModal> +
 *    <AppSettingsPanel>
 */
export default function App() {
  // ─── 顶层 state ────────────────────────────────────────────────
  const [items, setItems] = useState<ChatItem[]>(createEmptyState());
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [cwd, setCwd] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [prefs, setPrefs] = useState<ClientPrefs | null>(null);
  const [availableThinkingLevels, setAvailableThinkingLevels] =
    useState<ThinkingLevel[] | null>(null);
  const [bash, setBash] = useState<BashCheckResult | null>(null);
  const [git, setGit] = useState<GitCheckResult | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [piCli, setPiCli] = useState<PiCliStatus | null>(null);
  const [piCliInstalling, setPiCliInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionMode, setSessionMode] = useState<AgentSessionMode>("agent");
  const [sessionType, setSessionType] = useState<SessionType>(DEFAULT_SESSION_TYPE);
  const [planPath, setPlanPath] = useState<string | null>(null);
  const [goal, setGoal] = useState<GoalInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  const [queuedSteering, setQueuedSteering] = useState<string[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [followNonce, setFollowNonce] = useState(0);
  const [readyBusy, setReadyBusy] = useState(false);
  const [readyNotice, setReadyNotice] = useState<string | null>(null);
  const [prefsRecovery, setPrefsRecovery] = useState<PrefsRecoveryNotice | null>(null);
  const [secretCodec, setSecretCodec] = useState<SecretCodecStatus | null>(null);
  const usageFetchGen = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const chatStreamRef = useRef<HTMLDivElement | null>(null);
  const topbarElevated = useScrollElevated(chatStreamRef);
  useSyncExternalStore(
    subscribeSessionUsageStore,
    getSessionUsageStoreVersion,
    getSessionUsageStoreVersion,
  );
  const sessionUsage = getSessionUsageState();
  const compacting = getCompacting();
  const appUpdate = useAppUpdate({ onError: (message) => setError(message) });
  const { status: updateStatus, busy: updateActionBusy, onTopBarUpdateClick } = appUpdate;
  const logo = useLogo(prefs);

  // ─── 工具 IPC 包装 (refreshSessions / refreshModels) ──────────────
  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await window.xAgent.workspace.listSessions());
    } catch {
      // D10: 保留旧列表
    } finally {
      setSessionsLoaded(true);
    }
  }, []);
  const refreshModels = useCallback(async () => {
    try {
      setModels(await window.xAgent.session.listModels());
    } catch {
      // D10
    }
  }, []);
  const sessionsLoading = !sessionsLoaded;

  // ─── Project readiness (Godot / RPC / ready) ─────────────────────
  const { isGodotProject, setRpcStatus, setAddonInstalled, setReadyChecklistHidden, refreshProjectReadiness, projectKey, readyItems, showReadyChecklist, showGodotToolsNudge } = useProjectReadiness({
    cwd, prefs, bash, git, auth, piCli, modelCount: models.length,
  });

  // ─── Retract / edit / regenerate 流程 (放在 useWorkspaceSession 之前,
  // 后者需要 setConfirmState) ──────────────────────────────────
  const { confirmState, retractBusy, beginConfirm, runConfirmedRetract, cancelConfirm, setConfirmState } = useRetractConfirm({
    editDraft,
    setError,
    setInput: (() => undefined) as React.Dispatch<React.SetStateAction<string>>,
    setEditingEntryId,
    setEditDraft,
    refreshSessions,
  });

  // ─── Goal 状态机 (主题 F C-202) ────────────────────────────────
  // 通过 ref 解开顺序: useGoalMode 需要 composer 的 input 真值, 但
  // useComposer 还没创建. 注入一个 placeholder, 创建后回填.
  const composerRef = useRef<ReturnType<typeof useComposer> | null>(null);
  const goalApi = useGoalMode({
    setGoal,
    setSessionMode,
    setPlanPath,
    onClearGoalDraft: () => {
      const cur = composerRef.current?.input ?? "";
      if (cur.trim().startsWith("/goal")) composerRef.current?.setInput("");
    },
    setFollowNonce,
    setError,
    goal,
    sessionMode,
  });
  const goalDispatcherRef = useRef<Pick<GoalModeApi, "handleGoalCommand">>({
    handleGoalCommand: async () => false,
  });
  goalDispatcherRef.current = goalApi;

  // ─── Workspace session 6 method (open / new / resume / delete ...) ─
  const { openProject, newSession, resumeSession, deleteSession, deleteProjectSessions, hideProject, renameSession } = useWorkspaceSession({
    setItems, setStatus, setCwd, setSessionId, setError,
    setBusy, setSessionType, setSessionMode, setPlanPath, setGoal,
    setQueuedSteering, setEditingEntryId, setEditDraft,
    setInput: (() => undefined) as React.Dispatch<React.SetStateAction<string>>,
    setConfirmState, setFollowNonce, setPrefs, setAvailableThinkingLevels,
    setPrefsRecovery, setSecretCodec, setBash, setGit, setAuth, setPiCli,
    refreshSessions, refreshModels, refreshProjectReadiness,
    prefs, cwd, sessionIdRef, usageFetchGen,
  });

  // ─── Composer 状态机 (主题 F C-205) ────────────────────────────
  const currentModelKey = useMemo(
    () => (prefs?.provider && prefs?.model ? `${prefs.provider}/${prefs.model}` : ""),
    [prefs],
  );
  const composer = useComposer({
    cwd, models, currentModelKey, status, sessionMode, goal,
    setError, setFollowNonce, setItems,
    goalDispatcher: goalDispatcherRef.current,
    refreshSessions,
  });
  composerRef.current = composer;
  const setInputRef = useRef<(v: string) => void>(() => undefined);
  setInputRef.current = (v) => composer.setInput(v);

  // ─── 启动期初始化 (主题 F) ─────────────────────────────────────
  useSessionBootstrap({
    setPrefs, setPrefsRecovery, setSecretCodec, setBash, setGit, setAuth,
    setPiCli, setItems, setQueuedSteering, setCwd, setSessionId,
    setSessionType, setFollowNonce, setError, setBusy,
    setAvailableThinkingLevels, setEditingEntryId, setEditDraft,
    setConfirmState: () => undefined, // legacy, useRetractConfirm 自己管
    sessionIdRef, usageFetchGen, refreshModels, refreshSessions,
    refreshProjectReadiness,
    fetchSessionUsage: () => undefined, // legacy, useWorkspaceSession 自己管
  });

  // ─── 业务 actions 集合 (主题 F C-201) ─────────────────────────
  const actions = useAppActions({
    prefs, setPrefs, setError, setReadyNotice, setReadyBusy, setPiCli,
    setRpcStatus, setAddonInstalled, projectKey, setReadyChecklistHidden,
    setPiCliInstalling, cwd, refreshProjectReadiness,
    hasActiveSession: Boolean(sessionId),
  });
  const layout = useAppLayout({ prefs, setPrefs });

  // ─── Agent 事件路由 (主题 F C-207, 拆 4 子 hook) ──────────────
  useAgentEventRouter({
    setStatus, setError, setCwd, setSessionId, setSessionType,
    sessionIdRef, usageFetchGen, setPrefs, setAvailableThinkingLevels,
    setQueuedSteering, setEditingEntryId, setItems, setSessionMode,
    setPlanPath, setGoal, refreshSessions, onApiStatus: composer.apiStatusRef,
  });

  // ─── 副作用: cwd / sessionType / sessionId / keyboard ─────────
  useEffect(() => { setReadyNotice(null); }, [cwd]);
  useEffect(() => {
    const next = sessionType ?? DEFAULT_SESSION_TYPE;
    document.body.dataset.sessionType = next;
    return () => {
      if (document.body.dataset.sessionType === next) {
        document.body.dataset.sessionType = DEFAULT_SESSION_TYPE;
      }
    };
  }, [sessionType]);
  useEffect(() => { if (!editingEntryId) setEditDraft(""); }, [editingEntryId]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsTab("general");
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ─── Auto compact (上下文接近上限自动 compact) ─────────────────
  useAutoCompact({
    thresholdPercent: prefs?.autoCompactPercent ?? 0,
    usage: sessionUsage,
    busy: busy || status === "streaming" || status === "retrying" || retractBusy,
    compacting,
    sessionId,
  });

  // ─── 业务 callbacks (4 个) ─────────────────────────────────────
  const onBuildPlan = useCallback(async () => {
    setError(null);
    const result = await window.xAgent.plan.build();
    if (!result.ok) setError(result.error ?? "执行计划失败");
    else {
      const mode = await window.xAgent.plan.getMode();
      setSessionMode(mode.mode);
      setPlanPath(mode.planPath);
    }
    await refreshSessions();
  }, [refreshSessions, setError, setSessionMode, setPlanPath]);

  const onCycleSessionMode = useCallback(() => {
    if (status === "streaming" || status === "retrying" || !cwd) return;
    void goalApi.cycleSessionMode();
  }, [status, cwd, goalApi]);

  const addPathToChat = useCallback(
    (relPath: string) => composer.setInput((prev: string) => appendAtPath(prev, relPath)),
    [composer],
  );
  const pickStarter = useCallback(
    (prompt: string) => composer.setInput(prompt),
    [composer],
  );
  const onStartEdit = useCallback(
    (entryId: string, text: string) => {
      setEditingEntryId(entryId);
      setEditDraft(collapseFileBlocksToAtPaths(text));
    },
    [],
  );
  const onCancelEdit = useCallback(() => {
    setEditingEntryId(null);
    setEditDraft("");
  }, []);
  const onConfirmEdit = useCallback(() => {
    if (!editingEntryId || !editDraft.trim()) return;
    void beginConfirm("edit", editingEntryId, editDraft);
  }, [editingEntryId, editDraft, beginConfirm]);
  const onRetract = useCallback(
    (id: string) => void beginConfirm("retract", id),
    [beginConfirm],
  );
  const onRegenerate = useCallback(
    (id: string) => void beginConfirm("regenerate", id),
    [beginConfirm],
  );

  // ─── 设置 / bash / 工具面板 小包装 ────────────────────────────
  const openSettings = () => {
    setSettingsTab(undefined);
    setSettingsOpen(true);
  };
  const openSettingsAt = useCallback(
    (tab: SettingsTabTarget) => {
      setSettingsTab(tab);
      setSettingsOpen(true);
    },
    [],
  );
  const applyBash = useCallback(async () => {
    const result = await window.xAgent.prefs.applyBashShellPath(
      bash?.suggestedShellPath ?? undefined,
    );
    setBash(result);
    if (!result.ok) setError(result.message);
    else setError(null);
  }, [bash, setBash, setError]);
  const handleOpenToolInPanel = useCallback(
    (toolId: string, args: unknown) => {
      openToolInRightPanel(toolId, args, () => {
        void layout.ensureRightPanelOpen();
      });
    },
    [layout],
  );

  usePlanSessionAutoOpen(planPath, layout.ensureRightPanelOpen);

  return (
    <div className="app-shell">
      <TopBar
        cwd={cwd}
        status={status}
        theme={prefs?.colorMode ?? "dark"}
        onOpenProject={openProject}
        onNewCodeSession={() => void newSession("code")}
        onNewDesignSession={() => void newSession("design")}
        onToggleTheme={actions.toggleTheme}
        onToggleRightPanel={layout.toggleRightPanel}
        onOpenSettings={openSettings}
        onUpdateAction={onTopBarUpdateClick}
        updateStatus={updateStatus}
        updateActionBusy={updateActionBusy}
        rightPanelOpen={prefs?.rightPanelOpen ?? false}
        compacting={compacting}
        busy={busy}
        elevated={topbarElevated}
      />
      <AppBanners
        error={error}
        setError={setError}
        prefsRecovery={prefsRecovery}
        setPrefsRecovery={setPrefsRecovery}
        secretCodec={secretCodec}
        setSecretCodec={setSecretCodec}
        readyBusy={readyBusy}
        piCliInstalling={piCliInstalling}
        readyNotice={readyNotice}
        setReadyNotice={setReadyNotice}
        showReadyChecklist={showReadyChecklist}
        showGodotToolsNudge={showGodotToolsNudge}
        setReadyChecklistHidden={setReadyChecklistHidden}
        readyItems={readyItems}
        actions={actions}
        applyBash={applyBash}
        openSettingsAt={openSettingsAt}
        busy={busy}
      />
      <AppMainRow
        sidebarActions={{
          onResume: resumeSession,
          onDelete: deleteSession,
          onDeleteProjectSessions: deleteProjectSessions,
          onHideProject: hideProject,
          onRename: renameSession,
          onRefresh: refreshSessions,
        }}
        chatActions={{
          setInput: composer.setInput,
          onSend: composer.send,
          onAbort: composer.abort,
          onAddFiles: composer.onAddFiles,
          onRemoveImage: composer.onRemoveImage,
          onRemoveFile: composer.onRemoveFile,
          onPickStarter: pickStarter,
          onOpenToolInPanel: handleOpenToolInPanel,
          onEditDraftChange: setEditDraft,
          onStartEdit: onStartEdit,
          onCancelEdit: onCancelEdit,
          onConfirmEdit: onConfirmEdit,
          onRetract: onRetract,
          onRegenerate: onRegenerate,
          onSessionModeChange: goalApi.changeSessionMode,
          onBuildPlan: onBuildPlan,
          onClearGoal: goalApi.clearGoal,
          onPauseGoal: goalApi.pauseGoal,
          onResumeGoal: goalApi.resumeGoal,
          onCycleSessionMode: onCycleSessionMode,
          onClarifySelect: composer.onClarifySelect,
          onModelChange: actions.onModelChange,
          onThinkingChange: actions.onThinkingChange,
          onToggleThinking: actions.toggleThinking,
          onAutoCompactPercentChange: (p) => void window.xAgent.prefs.set({ autoCompactPercent: p }).then(setPrefs),
          onCloseRightPanel: layout.toggleRightPanel,
          onAddPathToChat: addPathToChat,
          onPlanPathChange: setPlanPath,
          onEnableGodotTools: actions.enableGodotEditorTools,
          openSettingsAt,
        }}
        sessions={sessions}
        hiddenProjectKeys={prefs?.hiddenProjectKeys ?? []}
        activeSessionId={sessionId}
        activeCwd={cwd}
        agentStatus={status}
        busy={busy}
        compacting={compacting}
        sessionsLoading={sessionsLoading}
        items={items}
        showThinking={prefs?.showThinking ?? true}
        apiStatus={composer.apiStatusView}
        input={composer.input}
        externalStreamRef={chatStreamRef}
        attachments={composer.attachments}
        fileRefs={composer.fileRefs}
        skillsRefreshKey={`${cwd ?? ""}:${sessionId ?? ""}`}
        queuedSteering={queuedSteering}
        forceFollowKey={`${sessionId ?? ""}:${followNonce}`}
        sessionType={sessionType}
        isGodotProject={isGodotProject}
        editingEntryId={editingEntryId}
        editDraft={editDraft}
        sessionMode={sessionMode}
        planPath={planPath}
        goal={goal}
        models={models}
        currentModelKey={currentModelKey}
        thinkingLevel={prefs?.thinkingLevel ?? "high"}
        availableThinkingLevels={availableThinkingLevels}
        usage={sessionUsage}
        sessionId={sessionId}
        autoCompactPercent={prefs?.autoCompactPercent ?? 0}
        layout={layout}
        setPrefs={setPrefs}
        retractBusy={retractBusy}
        prefs={prefs}
      />
      {confirmState && (
        <RetractConfirmModal
          mode={confirmState.mode}
          preview={confirmState.preview}
          busy={retractBusy}
          onCancel={() => { if (!retractBusy) cancelConfirm(); }}
          onConfirm={() => { void runConfirmedRetract(); }}
        />
      )}
      {prefs && settingsOpen && (
        <AppSettingsPanel
          open={settingsOpen}
          prefs={prefs}
          cwd={cwd}
          logo={logo}
          initialTab={settingsTab}
          hasActiveSession={Boolean(sessionId)}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsTab(undefined);
          }}
          onToggleTool={actions.toggleTool}
          onPrefsChanged={setPrefs}
          onBashChanged={setBash}
          onGitChanged={setGit}
          onPiCliChanged={setPiCli}
          onProvidersChanged={async () => {
            await refreshModels();
            setPrefs(await window.xAgent.prefs.get());
          }}
          setAuth={setAuth}
        />
      )}
    </div>
  );
}
