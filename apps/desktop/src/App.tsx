import { AlertTriangle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
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
import { GODOT_TOOLS, THINKING_LEVELS, isRestorableGoalStatus } from "@shared/ipc";
import type { GameStage } from "@shared/game-stage";
import { dbgLog, dbgTimer } from "@shared/debug-log";
import {
  GIT_FOR_WINDOWS_DOWNLOAD_URL,
  NODE_JS_DOWNLOAD_URL,
} from "@shared/runtime-deps";
import { useConfirm } from "./lib/app-confirm";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { RetractConfirmModal } from "./components/RetractConfirmModal";
import {
  GodotToolsNudge,
  ReadyChecklist,
  type SettingsTabTarget,
} from "./components/ReadyChecklist";
import { TopBar } from "./components/TopBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { openToolInRightPanel, RightPanel } from "./components/RightPanel";
import {
  SettingsPanel,
  type SettingsTab,
} from "./components/SettingsPanel";
import {
  appendAtPath,
  collapseFileBlocksToAtPaths,
  expandAtPathsInPrompt,
} from "./lib/expandAtPaths";
import { startersForProject } from "./lib/chat-starters";
import { allGodotEditorToolsEnabled } from "./lib/ready-checklist";
import {
  RIGHT_PANEL_WIDTH_DEFAULT,
  RIGHT_PANEL_WIDTH_MAX,
  RIGHT_PANEL_WIDTH_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  fitColumnWidths,
  useColumnResize,
} from "./hooks/useColumnResize";
import { useAgentEventRouter } from "./hooks/useAgentEventRouter";
import type { ApiStatus } from "./hooks/useAgentEventRouter";
import { useAutoCompact } from "./hooks/useAutoCompact";
import { usePlanSessionAutoOpen } from "./hooks/usePlanSession";
import { useProjectReadiness } from "./hooks/useProjectReadiness";
import { useRetractConfirm } from "./hooks/useRetractConfirm";
import { useWorkspaceSession } from "./hooks/useWorkspaceSession";
import {
  appendPendingUser,
  createEmptyState,
  makePendingUserId,
  removePendingUser,
} from "./stores/chat-store";
import {
  getCompacting,
  getSessionUsageState,
  getSessionUsageStoreVersion,
  subscribeSessionUsageStore,
} from "./stores/session-usage-store";
import { applyTheme } from "./lib/theme";

export default function App() {
  const confirm = useConfirm();
  const [items, setItems] = useState(createEmptyState());
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [cwd, setCwd] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [prefs, setPrefs] = useState<ClientPrefs | null>(null);
  const [bash, setBash] = useState<BashCheckResult | null>(null);
  const [git, setGit] = useState<GitCheckResult | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [piCli, setPiCli] = useState<PiCliStatus | null>(null);
  const [piCliInstalling, setPiCliInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionMode, setSessionMode] = useState<AgentSessionMode>("agent");
  const [planPath, setPlanPath] = useState<string | null>(null);
  const [gameStage, setGameStage] = useState<GameStage | null>(null);
  const [goal, setGoal] = useState<GoalInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(
    undefined,
  );
  const [queuedSteering, setQueuedSteering] = useState<string[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [followNonce, setFollowNonce] = useState(0);
  // Live API-phase for the composer's status line ("模型响应中… 67s" etc).
  // Ref-captured callback so the router effect stays stable; plain state for render.
  const apiStatusRef = useRef<(status: ApiStatus) => void>(() => undefined);
  const [apiStatus, setApiStatus] = useState<ApiStatus>(null);
  // 渲染期写 ref 在并发渲染下可能中断；改为 effect 同步 setter。
  useEffect(() => {
    apiStatusRef.current = setApiStatus;
  });
  // Tick once a second so the "已等待 Ns" counter re-renders while waiting.
  const [, setApiTick] = useState(0);
  useEffect(() => {
    if (!apiStatus) return;
    if (apiStatus.phase === "receiving") return;
    const id = setInterval(() => setApiTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [apiStatus]);
  // View-model for the composer: include waitedMs only when we have a start time.
  const apiStatusView = apiStatus
    ? apiStatus.phase === "receiving"
      ? { phase: "receiving" as const }
      : { phase: apiStatus.phase, waitedMs: Date.now() - apiStatus.startedAt }
    : null;
  const [readyBusy, setReadyBusy] = useState(false);
  const [readyNotice, setReadyNotice] = useState<string | null>(null);
  const [prefsRecovery, setPrefsRecovery] =
    useState<PrefsRecoveryNotice | null>(null);
  const [secretCodec, setSecretCodec] = useState<SecretCodecStatus | null>(
    null,
  );
  const usageFetchGen = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const usageVersion = useSyncExternalStore(
    subscribeSessionUsageStore,
    getSessionUsageStoreVersion,
    getSessionUsageStoreVersion,
  );
  void usageVersion;
  const sessionUsage = getSessionUsageState();
  const compacting = getCompacting();
  const appUpdate = useAppUpdate({
    onError: (message) => setError(message),
  });
  const {
    status: updateStatus,
    busy: updateActionBusy,
    showBanner: showUpdateBanner,
    dismiss: dismissUpdateBanner,
    downloadOrInstall: applyUpdateAction,
    onTopBarUpdateClick,
  } = appUpdate;

  const {
    isGodotProject,
    rpcStatus,
    setRpcStatus,
    setAddonInstalled,
    addonInstalled,
    setReadyChecklistHidden,
    refreshProjectReadiness,
    projectKey,
    readyItems,
    showReadyChecklist,
    showGodotToolsNudge,
  } = useProjectReadiness({
    cwd,
    prefs,
    bash,
    git,
    auth,
    piCli,
    modelCount: models.length,
  });

  const refreshSessions = useCallback(async () => {
    try {
      const list = await window.xAgent.workspace.listSessions();
      setSessions(list);
      setSessionsLoaded(true);
    } catch {
      // D10: IPC 异常时保持旧列表，避免 unhandled rejection。
      setSessionsLoaded(true);
    }
  }, []);
  const sessionsLoading = !sessionsLoaded;

  const refreshModels = useCallback(async () => {
    try {
      const list = await window.xAgent.session.listModels();
      setModels(list);
    } catch {
      // D10: IPC 异常时保持旧模型列表。
    }
  }, []);

  const {
    confirmState,
    retractBusy,
    beginConfirm,
    runConfirmedRetract,
    cancelConfirm,
    setConfirmState,
  } = useRetractConfirm({
    editDraft,
    setError,
    setInput,
    setEditingEntryId,
    setEditDraft,
    refreshSessions,
  });

  const {
    openProject,
    newSession,
    resumeSession,
    deleteSession,
    deleteProjectSessions,
    hideProject,
    renameSession,
  } = useWorkspaceSession({
    setItems,
    setStatus,
    setCwd,
    setSessionId,
    setError,
    setBusy,
    setSessionMode,
    setPlanPath,
    setGoal,
    setQueuedSteering,
    setEditingEntryId,
    setEditDraft,
    setInput,
    setConfirmState,
    setFollowNonce,
    setPrefs,
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
  });

  useAutoCompact({
    thresholdPercent: prefs?.autoCompactPercent ?? 0,
    usage: sessionUsage,
    busy:
      busy ||
      status === "streaming" ||
      status === "retrying" ||
      retractBusy,
    compacting,
    sessionId,
  });

  useAgentEventRouter({
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
    onApiStatus: apiStatusRef,
  });

  useEffect(() => {
    setReadyNotice(null);
  }, [cwd]);

  const chatStarters = useMemo(
    () => startersForProject(isGodotProject),
    [isGodotProject],
  );

  useEffect(() => {
    if (!editingEntryId) setEditDraft("");
  }, [editingEntryId]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const currentModelKey = useMemo(() => {
    const m =
      prefs?.provider && prefs?.model ? `${prefs.provider}/${prefs.model}` : "";
    return m;
  }, [prefs]);

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

  const send = useCallback(async () => {
    if (!input.trim() || !cwd) {
      dbgLog("chat", "send skipped (empty or no cwd)", { hasInput: !!input, hasCwd: !!cwd });
      return;
    }
    const text = input.trim();
    setInput("");
    setError(null);
    setFollowNonce((n) => n + 1);
    dbgLog("chat", "send invoked", { len: text.length, preview: text.slice(0, 80), status, sessionMode });

    // Slash: /goal — host IPC, not model prompt.
    if (/^\/goal\s+clear\b/i.test(text) || /^\/goal\s*$/i.test(text)) {
      if (/clear/i.test(text)) {
        const result = await window.xAgent.plan.clearGoal();
        if (!result.ok) setError(result.error ?? "清除目标失败");
        else {
          setGoal(null);
          setSessionMode("agent");
        }
      } else {
        const g = await window.xAgent.plan.getGoal();
        setGoal(g);
        setError(
          g
            ? `目标 (${g.status}): ${g.condition} · ${g.turns}/${g.maxTurns} 轮 · ${g.tokensUsed}/${g.maxTokens} tok`
            : "当前无活跃目标。切换到「目标」模式后输入完成条件并发送。",
        );
      }
      return;
    }
    if (/^\/goal\s+pause\b/i.test(text)) {
      const result = await window.xAgent.plan.pauseGoal();
      if (!result.ok) setError(result.error ?? "暂停目标失败");
      else if (result.goal) setGoal(result.goal);
      return;
    }
    if (/^\/goal\s+resume\b/i.test(text) || /^\/goal\s+continue\b/i.test(text)) {
      const result = await window.xAgent.plan.resumeGoal();
      if (!result.ok) setError(result.error ?? "继续目标失败");
      else {
        if (result.goal) setGoal(result.goal);
        setSessionMode("goal");
      }
      return;
    }
    const goalSet = text.match(/^\/goal\s+(.+)$/is);
    if (goalSet?.[1] && !/^(clear|pause|resume|continue)\b/i.test(goalSet[1].trim())) {
      const result = await window.xAgent.plan.setGoal(goalSet[1].trim());
      if (!result.ok) setError(result.error ?? "设置目标失败");
      else {
        if (result.goal) setGoal(result.goal);
        setSessionMode("goal");
      }
      return;
    }

    // Goal 模式且尚未设置条件：整条消息即完成条件。
    if (sessionMode === "goal" && !isRestorableGoalStatus(goal?.status)) {
      const result = await window.xAgent.plan.setGoal(text);
      if (!result.ok) setError(result.error ?? "设置目标失败");
      else {
        if (result.goal) setGoal(result.goal);
        setSessionMode("goal");
      }
      return;
    }

    // Show the bubble immediately — host events only arrive after shadow-git
    // checkpoint + Pi message_start (or history_replace at turn end).
    const pendingId = makePendingUserId();
    setItems((prev) => appendPendingUser(prev, text, pendingId));

    const doneExpand = dbgTimer("chat", "expandAtPathsInPrompt");
    const expanded = await expandAtPathsInPrompt(text);
    doneExpand();
    const doneRoundtrip = dbgTimer("chat", "window.xAgent.turn.prompt roundtrip");
    const result = await window.xAgent.turn.prompt(expanded);
    doneRoundtrip();
    dbgLog("chat", "turn.prompt resolved", { ok: result.ok, silent: result.silent, error: result.error });
    if (!result.ok || result.silent) {
      setItems((prev) => removePendingUser(prev, pendingId));
      if (!result.ok) setError(result.error ?? "发送失败");
    }
    await refreshSessions();
  }, [input, cwd, sessionMode, goal, refreshSessions, status]);

  const onSessionModeChange = useCallback(
    async (mode: AgentSessionMode) => {
      const result = await window.xAgent.plan.setMode(mode);
      if (!result.ok) {
        setError(result.error ?? "切换模式失败");
        return;
      }
      if (result.info) {
        setSessionMode(result.info.mode);
        setPlanPath(result.info.planPath);
      }
      if (mode === "agent" || mode === "ask" || mode === "plan") {
        setGoal(null);
        // 离开目标模式时清掉输入框里残留的 /goal 命令草稿
        setInput((prev) => (prev.trim().startsWith("/goal") ? "" : prev));
      }
      if (mode === "goal" && result.needGoalCondition) {
        // 不预填 /goal；仅清空误留的 slash 草稿，让用户直接写完成条件
        setInput((prev) => (prev.trim().startsWith("/goal") ? "" : prev));
        setFollowNonce((n) => n + 1);
      }
    },
    [setError, setSessionMode, setPlanPath, setGoal, setInput, setFollowNonce],
  );

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

  const onGameStageChange = useCallback(
    async (stage: GameStage) => {
      const result = await window.xAgent.game.set(stage);
      if (!result.ok) setError(result.error ?? "切换游戏阶段失败");
      else if (result.info) setGameStage(result.info.stage);
    },
    [setError, setGameStage],
  );

  const onClearGoal = useCallback(async () => {
    const result = await window.xAgent.plan.clearGoal();
    if (!result.ok) setError(result.error ?? "清除目标失败");
    else {
      setGoal(null);
      setSessionMode("agent");
    }
  }, [setError, setGoal, setSessionMode]);

  const onPauseGoal = useCallback(async () => {
    const result = await window.xAgent.plan.pauseGoal();
    if (!result.ok) setError(result.error ?? "暂停目标失败");
    else if (result.goal) setGoal(result.goal);
  }, [setError, setGoal]);

  const onResumeGoal = useCallback(async () => {
    const result = await window.xAgent.plan.resumeGoal();
    if (!result.ok) setError(result.error ?? "继续目标失败");
    else {
      if (result.goal) setGoal(result.goal);
      setSessionMode("goal");
    }
  }, [setError, setGoal, setSessionMode]);

  const MODE_CYCLE: AgentSessionMode[] = ["agent", "ask", "plan", "goal"];

  const onCycleSessionMode = useCallback(() => {
    if (status === "streaming" || status === "retrying" || !cwd) return;
    const idx = MODE_CYCLE.indexOf(sessionMode);
    const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length]!;
    void onSessionModeChange(next);
  }, [status, cwd, sessionMode, onSessionModeChange]);

  const abort = useCallback(async () => {
    dbgLog("chat", "abort invoked");
    const done = dbgTimer("chat", "window.xAgent.turn.abort roundtrip");
    try {
      await window.xAgent.turn.abort();
      done();
    } catch (err) {
      dbgLog("chat", "abort threw", err instanceof Error ? err.message : String(err));
    }
  }, []);

  const addPathToChat = useCallback((relPath: string) => {
    setInput((prev) => appendAtPath(prev, relPath));
  }, []);

  const onStartEdit = useCallback(
    (entryId: string, text: string) => {
      setEditingEntryId(entryId);
      setEditDraft(collapseFileBlocksToAtPaths(text));
    },
    [setEditingEntryId, setEditDraft],
  );

  const onCancelEdit = useCallback(() => {
    setEditingEntryId(null);
    setEditDraft("");
  }, [setEditingEntryId, setEditDraft]);

  const onConfirmEdit = useCallback(() => {
    if (!editingEntryId || !editDraft.trim()) return;
    void beginConfirm("edit", editingEntryId, editDraft);
  }, [editingEntryId, editDraft, beginConfirm]);

  const onRetract = useCallback(
    (entryId: string) => {
      void beginConfirm("retract", entryId);
    },
    [beginConfirm],
  );

  const onRegenerate = useCallback(
    (userEntryId: string) => {
      void beginConfirm("regenerate", userEntryId);
    },
    [beginConfirm],
  );

  const onModelChange = async (value: string) => {
    const [provider, ...rest] = value.split("/");
    const id = rest.join("/");
    if (!provider || !id) return;
    const result = await window.xAgent.session.setModel(provider, id);
    if (!result.ok) setError(result.error ?? "切换模型失败");
    else {
      setPrefs((prev) => (prev ? { ...prev, provider, model: id } : prev));
    }
  };

  const onThinkingChange = async (level: ThinkingLevel) => {
    const result = await window.xAgent.session.setThinkingLevel(level);
    if (!result.ok) {
      setError("切换 Thinking 失败（请先打开项目）");
      return;
    }
    // Use the model-clamped effective level the host returned instead of a
    // racy `prefs.get()` round trip: the prefs cache can lag the session apply
    // and would snap the composer select back to the stale level.
    const effective = result.thinkingLevel ?? level;
    setPrefs((prev) =>
      prev ? { ...prev, thinkingLevel: effective } : prev,
    );
  };

  const toggleThinking = async () => {
    if (!prefs) return;
    const showThinking = !prefs.showThinking;
    setPrefs({ ...prefs, showThinking });
    const next = await window.xAgent.prefs.set({ showThinking });
    setPrefs(next);
  };

  const toggleTheme = async () => {
    if (!prefs) return;
    const colorMode = prefs.colorMode === "dark" ? "light" : "dark";
    const next = await window.xAgent.prefs.set({ colorMode });
    setPrefs(next);
    applyTheme(next.themeId, next.colorMode);
  };

  const commitSidebarWidth = useCallback(async (sidebarWidth: number) => {
    setPrefs((prev) => (prev ? { ...prev, sidebarWidth } : prev));
    const next = await window.xAgent.prefs.set({ sidebarWidth });
    setPrefs(next);
  }, []);

  const commitRightPanelWidth = useCallback(async (rightPanelWidth: number) => {
    setPrefs((prev) => (prev ? { ...prev, rightPanelWidth } : prev));
    const next = await window.xAgent.prefs.set({ rightPanelWidth });
    setPrefs(next);
  }, []);

  const {
    width: sidebarWidth,
    dragging: sidebarResizing,
    onResizePointerDown: onSidebarResizePointerDown,
    onResizeDoubleClick: onSidebarResizeDoubleClick,
  } = useColumnResize({
    initialWidth: prefs?.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT,
    min: SIDEBAR_WIDTH_MIN,
    max: SIDEBAR_WIDTH_MAX,
    defaultWidth: SIDEBAR_WIDTH_DEFAULT,
    axis: "grow-right",
    onCommit: (w) => {
      void commitSidebarWidth(w);
    },
  });

  const {
    width: rightPanelWidth,
    dragging: rightPanelResizing,
    onResizePointerDown: onRightPanelResizePointerDown,
    onResizeDoubleClick: onRightPanelResizeDoubleClick,
  } = useColumnResize({
    initialWidth: prefs?.rightPanelWidth ?? RIGHT_PANEL_WIDTH_DEFAULT,
    min: RIGHT_PANEL_WIDTH_MIN,
    max: RIGHT_PANEL_WIDTH_MAX,
    defaultWidth: RIGHT_PANEL_WIDTH_DEFAULT,
    axis: "grow-left",
    onCommit: (w) => {
      void commitRightPanelWidth(w);
    },
  });

  const [viewportWidth, setViewportWidth] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth : 1280),
  );
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const layoutWidths = useMemo(
    () =>
      fitColumnWidths({
        viewportWidth,
        sidebarWidth,
        rightPanelWidth,
        rightPanelOpen: prefs?.rightPanelOpen ?? false,
      }),
    [
      viewportWidth,
      sidebarWidth,
      rightPanelWidth,
      prefs?.rightPanelOpen,
    ],
  );

  const toggleRightPanel = async () => {
    if (!prefs) return;
    const rightPanelOpen = !prefs.rightPanelOpen;
    setPrefs({ ...prefs, rightPanelOpen });
    const next = await window.xAgent.prefs.set({ rightPanelOpen });
    setPrefs(next);
  };

  const ensureRightPanelOpen = useCallback(async () => {
    if (prefs?.rightPanelOpen) return;
    const next = await window.xAgent.prefs.set({ rightPanelOpen: true });
    setPrefs(next);
  }, [prefs, setPrefs]);

  const handleOpenToolInPanel = useCallback(
    (toolId: string, args: unknown) => {
      openToolInRightPanel(toolId, args, () => {
        void ensureRightPanelOpen();
      });
    },
    [ensureRightPanelOpen],
  );

  const onClarifySelect = useCallback(
    async (reply: string) => {
      if (!cwd || !reply.trim()) return;
      const text = reply.trim();
      setError(null);
      setFollowNonce((n) => n + 1);
      const pendingId = makePendingUserId();
      setItems((prev) => appendPendingUser(prev, text, pendingId));
      const expanded = await expandAtPathsInPrompt(text);
      const result = await window.xAgent.turn.prompt(expanded);
      if (!result.ok || result.silent) {
        setItems((prev) => removePendingUser(prev, pendingId));
        if (!result.ok) {
          setError(result.error ?? "发送失败");
          setInput(reply);
        }
      }
      await refreshSessions();
    },
    [
      cwd,
      setError,
      setFollowNonce,
      setItems,
      setInput,
      refreshSessions,
    ],
  );

  usePlanSessionAutoOpen(planPath, ensureRightPanelOpen);

  const toggleTool = async (tool: string) => {
    if (!prefs) return;
    if (sessionId) {
      const ok = await confirm({
        title: "更改工具白名单",
        message: "会重建工具定义并清空本会话 API 缓存。确定继续？",
        confirmLabel: "继续",
        tone: "warn",
      });
      if (!ok) return;
    }
    const tools = prefs.tools.includes(tool)
      ? prefs.tools.filter((t) => t !== tool)
      : [...prefs.tools, tool];
    const next = await window.xAgent.prefs.set({ tools });
    setPrefs(next);
  };

  const applyBash = async () => {
    const result = await window.xAgent.applyBashShellPath(
      bash?.suggestedShellPath ?? undefined,
    );
    setBash(result);
    if (!result.ok) setError(result.message);
    else setError(null);
  };

  const openGitDownload = async () => {
    setError(null);
    const result = await window.xAgent.openExternalUrl(
      GIT_FOR_WINDOWS_DOWNLOAD_URL,
    );
    if (!result.ok) {
      setError(result.error ?? "无法打开 Git 下载页");
      return;
    }
    setReadyNotice("安装 Git 后，请在设置 → 通用中点击「检测」刷新状态。");
  };

  const openNodeDownload = async () => {
    setError(null);
    const result = await window.xAgent.openExternalUrl(NODE_JS_DOWNLOAD_URL);
    if (!result.ok) {
      setError(result.error ?? "无法打开 Node.js 下载页");
      return;
    }
    setReadyNotice(
      "安装 Node.js 22+ 后重新打开应用，即可一键安装 Pi CLI。",
    );
  };

  const openSettings = () => {
    setSettingsTab(undefined);
    setSettingsOpen(true);
  };

  const openSettingsAt = useCallback(
    (tab: SettingsTabTarget) => {
      setSettingsTab(tab);
      setSettingsOpen(true);
    },
    [setSettingsTab, setSettingsOpen],
  );

  const muteReadyChecklist = async () => {
    if (!prefs || !projectKey) return;
    const keys = new Set(prefs.dismissedReadyChecklistKeys ?? []);
    keys.add(projectKey);
    const next = await window.xAgent.prefs.set({
      dismissedReadyChecklistKeys: [...keys],
    });
    setPrefs(next);
    setReadyChecklistHidden(true);
  };

  const dismissGodotToolsNudge = async () => {
    if (!prefs || !projectKey) return;
    const keys = new Set(prefs.dismissedGodotToolsNudgeKeys ?? []);
    keys.add(projectKey);
    const next = await window.xAgent.prefs.set({
      dismissedGodotToolsNudgeKeys: [...keys],
    });
    setPrefs(next);
  };

  const enableGodotEditorTools = useCallback(async () => {
    if (!prefs) return;
    setReadyBusy(true);
    try {
      const without = prefs.tools.filter(
        (t) => !(GODOT_TOOLS as readonly string[]).includes(t),
      );
      const next = await window.xAgent.prefs.set({
        tools: [...without, ...GODOT_TOOLS],
      });
      setPrefs(next);
      await dismissGodotToolsNudge();
    } finally {
      setReadyBusy(false);
    }
  }, [prefs, setReadyBusy, setPrefs, dismissGodotToolsNudge]);

  const installRpcAddon = async () => {
    setReadyBusy(true);
    try {
      const res = await window.xAgent.installGodotRpcAddon();
      if (!res.ok) {
        setError(res.error ?? res.hint ?? "安装 RPC 插件失败");
      } else {
        setAddonInstalled(true);
        await window.xAgent.godotRpcStart().then(setRpcStatus).catch(() => {});
      }
      await refreshProjectReadiness(cwd);
    } finally {
      setReadyBusy(false);
    }
  };

  const startRpcBridge = async () => {
    setReadyBusy(true);
    setReadyNotice(null);
    setError(null);
    try {
      const status = await window.xAgent.godotRpcStart();
      setRpcStatus(status);
      if (status.error) {
        setError(status.error);
        setReadyNotice(status.error);
        return;
      }
      if (status.warning) {
        setReadyNotice(status.warning);
      } else if (status.running && (status.authenticatedClients ?? 0) > 0) {
        setReadyNotice(`桥接已连接 Godot（${status.authenticatedClients}）`);
      } else if (status.running) {
        setReadyNotice(
          `桥接已启动（端口 ${status.port}）。请在 Godot 启用 X-agent RPC 并保持编辑器打开。`,
        );
      } else {
        setReadyNotice("桥接未能启动，请到设置 → Godot 查看详情。");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setReadyNotice(msg);
    } finally {
      setReadyBusy(false);
    }
  };

  const launchGodotEditor = async () => {
    setReadyBusy(true);
    setReadyNotice(null);
    setError(null);
    try {
      // Ensure bridge is up before launching the editor.
      const status = await window.xAgent.godotRpcStart();
      setRpcStatus(status);
      if (status.error) {
        setError(status.error);
        setReadyNotice(status.error);
        return;
      }
      const res = await window.xAgent.launchGodotEditor();
      if (!res.ok) {
        const msg = res.error ?? "启动 Godot 编辑器失败";
        setError(msg);
        setReadyNotice(msg);
        return;
      }
      setReadyNotice(
        res.hint ??
          `已请求启动编辑器；桥接端口 ${status.port}，等待插件连入。`,
      );
      setRpcStatus(await window.xAgent.godotRpcStatus());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setReadyNotice(msg);
    } finally {
      setReadyBusy(false);
    }
  };

  const pickStarter = useCallback(
    (prompt: string) => {
      setInput(prompt);
    },
    [setInput],
  );

  const openPiLogin = async () => {
    setError(null);
    const result = await window.xAgent.openPiLogin();
    if (!result.ok) {
      setError(
        [result.error, result.hint].filter(Boolean).join(" — ") ||
          "无法打开 Pi 登录",
      );
      return;
    }
    if (result.hint) setError(result.hint);
  };

  const installPi = async () => {
    setPiCliInstalling(true);
    setError(null);
    try {
      const result = await window.xAgent.installPiCli();
      setPiCli(result);
      if (!result.ok) setError(result.message);
    } finally {
      setPiCliInstalling(false);
    }
  };

  return (
    <div className="app-shell">
      <TopBar
        cwd={cwd}
        status={status}
        theme={prefs?.colorMode ?? "dark"}
        onOpenProject={openProject}
        onNewSession={newSession}
        onToggleTheme={toggleTheme}
        onToggleRightPanel={toggleRightPanel}
        onOpenSettings={openSettings}
        onUpdateAction={onTopBarUpdateClick}
        updateStatus={updateStatus}
        updateActionBusy={updateActionBusy}
        rightPanelOpen={prefs?.rightPanelOpen ?? false}
        compacting={compacting}
        busy={busy}
      />
      {showUpdateBanner && updateStatus && (
        <UpdateBanner
          status={updateStatus}
          busy={updateActionBusy}
          onUpdate={() => {
            void applyUpdateAction();
          }}
          onDismiss={dismissUpdateBanner}
        />
      )}
      {prefsRecovery && (
        <div className="banner warn">
          <AlertTriangle size={14} />
          <span>
            偏好文件损坏，已使用默认设置
            {prefsRecovery.backedUp && prefsRecovery.backupPath
              ? `（备份：${prefsRecovery.backupPath}）`
              : `（${prefsRecovery.error}）`}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setPrefsRecovery(null)}
          >
            关闭
          </button>
        </div>
      )}
      {secretCodec && !secretCodec.available && (
        <div className="banner warn">
          <AlertTriangle size={14} />
          <span>
            供应商密钥将以明文存储——系统密钥链不可用
            {secretCodec.reason === "keychain-unavailable"
              ? "(safeStorage 不可用)"
              : secretCodec.reason === "encrypt-failed"
                ? "(safeStorage 加密失败)"
                : "(未在 Electron 环境中)"}
            。请到「设置 → 供应商」检查密钥是否需要重新保存。
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setSecretCodec(null)}
          >
            关闭
          </button>
        </div>
      )}
      {showReadyChecklist && (
        <ReadyChecklist
          items={readyItems}
          busy={readyBusy || busy}
          piCliInstalling={piCliInstalling}
          notice={readyNotice}
          onDismissNotice={() => setReadyNotice(null)}
          onDismiss={() => {
            setReadyChecklistHidden(true);
          }}
          onDontRemind={() => {
            void muteReadyChecklist();
          }}
          onOpenSettings={openSettingsAt}
          onInstallPiCli={() => {
            void installPi();
          }}
          onOpenPiLogin={() => {
            void openPiLogin();
          }}
          onApplyBash={() => {
            void applyBash();
          }}
          onOpenGitDownload={() => {
            void openGitDownload();
          }}
          onOpenNodeDownload={() => {
            void openNodeDownload();
          }}
          onInstallRpcAddon={() => {
            void installRpcAddon();
          }}
          onStartRpcBridge={() => {
            void startRpcBridge();
          }}
          onLaunchGodotEditor={() => {
            void launchGodotEditor();
          }}
          onEnableGodotTools={() => {
            void enableGodotEditorTools();
          }}
        />
      )}
      {showGodotToolsNudge && (
        <GodotToolsNudge
          visible
          busy={readyBusy}
          onEnable={() => {
            void enableGodotEditorTools();
          }}
          onDismiss={() => {
            void dismissGodotToolsNudge();
          }}
          onOpenSettings={() => openSettingsAt("tools")}
        />
      )}
      {error && (
        <div className="banner error">
          <AlertTriangle size={14} />
          <span>{error}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setError(null)}
          >
            关闭
          </button>
        </div>
      )}
      <div
        className={`main-row${prefs?.rightPanelOpen ? " with-right-panel" : ""}${sidebarResizing || rightPanelResizing ? " is-resizing" : ""}`}
        style={
          {
            "--sidebar-width": `${layoutWidths.sidebar}px`,
            "--right-panel-width": `${layoutWidths.right}px`,
          } as CSSProperties
        }
      >
        <Sidebar
          sessions={sessions}
          hiddenProjectKeys={prefs?.hiddenProjectKeys ?? []}
          activeSessionId={sessionId}
          activeCwd={cwd}
          agentStatus={status}
          busy={busy}
          compacting={compacting}
          sessionsLoading={sessionsLoading}
          onResume={resumeSession}
          onDelete={deleteSession}
          onDeleteProjectSessions={deleteProjectSessions}
          onHideProject={hideProject}
          onRename={renameSession}
          onRefresh={refreshSessions}
          onResizePointerDown={onSidebarResizePointerDown}
          onResizeDoubleClick={onSidebarResizeDoubleClick}
          resizing={sidebarResizing}
        />
        <ChatPanel
          items={items}
          showThinking={prefs?.showThinking ?? true}
          status={status}
          apiStatus={apiStatusView}
          input={input}
          setInput={setInput}
          onSend={send}
          onAbort={abort}
          disabled={!cwd}
          skillsRefreshKey={`${cwd ?? ""}:${sessionId ?? ""}`}
          queuedSteering={queuedSteering}
          forceFollowKey={`${sessionId ?? ""}:${followNonce}`}
          starters={chatStarters}
          readinessHints={
            !cwd
              ? undefined
              : [
                  ...(isGodotProject && !allGodotEditorToolsEnabled(prefs)
                    ? [
                        {
                          label: "启用 Godot 工具",
                          onClick: () => {
                            void enableGodotEditorTools();
                          },
                        },
                      ]
                    : []),
                  {
                    label: isGodotProject ? "Godot 设置" : "打开设置",
                    onClick: () =>
                      openSettingsAt(isGodotProject ? "godot" : "general"),
                  },
                ]
          }
          onPickStarter={pickStarter}
          onOpenToolInPanel={handleOpenToolInPanel}
          editingEntryId={editingEntryId}
          editDraft={editDraft}
          onEditDraftChange={setEditDraft}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onConfirmEdit={onConfirmEdit}
          onRetract={onRetract}
          onRegenerate={onRegenerate}
          sessionMode={sessionMode}
          gameStage={gameStage}
          onGameStageChange={onGameStageChange}
          planPath={planPath}
          goal={goal}
          onSessionModeChange={onSessionModeChange}
          onBuildPlan={onBuildPlan}
          onClearGoal={onClearGoal}
          onPauseGoal={onPauseGoal}
          onResumeGoal={onResumeGoal}
          onCycleSessionMode={onCycleSessionMode}
          onClarifySelect={onClarifySelect}
          models={models}
          currentModelKey={currentModelKey}
          thinkingLevel={prefs?.thinkingLevel ?? "high"}
          thinkingLevels={THINKING_LEVELS}
          onModelChange={onModelChange}
          onThinkingChange={onThinkingChange}
          onToggleThinking={toggleThinking}
        />
        {prefs?.rightPanelOpen && (
          <RightPanel
            cwd={cwd}
            gameStage={gameStage}
            items={items}
            enabledTools={prefs?.tools ?? []}
            usage={sessionUsage}
            compacting={compacting}
            sessionId={sessionId}
            planPath={planPath}
            autoCompactPercent={prefs?.autoCompactPercent ?? 0}
            onAutoCompactPercentChange={(percent) => {
              void (async () => {
                const next = await window.xAgent.prefs.set({
                  autoCompactPercent: percent,
                });
                setPrefs(next);
              })();
            }}
            busy={
              busy ||
              status === "streaming" ||
              status === "retrying" ||
              retractBusy
            }
            onClose={() => void toggleRightPanel()}
            onAddPathToChat={addPathToChat}
            onBuildPlan={() => {
              void onBuildPlan();
            }}
            onPlanPathChange={setPlanPath}
            onResizePointerDown={onRightPanelResizePointerDown}
            onResizeDoubleClick={onRightPanelResizeDoubleClick}
            resizing={rightPanelResizing}
          />
        )}
      </div>
      {confirmState && (
        <RetractConfirmModal
          mode={confirmState.mode}
          preview={confirmState.preview}
          busy={retractBusy}
          onCancel={() => {
            if (!retractBusy) cancelConfirm();
          }}
          onConfirm={() => {
            void runConfirmedRetract();
          }}
        />
      )}
      {prefs && (
        <SettingsPanel
          open={settingsOpen}
          prefs={prefs}
          cwd={cwd}
          initialTab={settingsTab}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsTab(undefined);
          }}
          onToggleTool={toggleTool}
          hasActiveSession={Boolean(sessionId)}
          onPrefsChanged={(p) => {
            setPrefs(p);
            applyTheme(p.themeId, p.colorMode);
          }}
          onBashChanged={setBash}
          onGitChanged={setGit}
          onPiCliChanged={setPiCli}
          onProvidersChanged={async () => {
            await refreshModels();
            const p = await window.xAgent.prefs.get();
            setPrefs(p);
            setAuth(await window.xAgent.prefs.checkAuth());
          }}
        />
      )}
    </div>
  );
}
