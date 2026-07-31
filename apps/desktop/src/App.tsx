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
  ColorMode,
  GitCheckResult,
  GoalInfo,
  ModelInfo,
  PiCliStatus,
  PrefsRecoveryNotice,
  SessionInfo,
  ThemeId,
  ThinkingLevel,
} from "@shared/ipc";
import { GODOT_TOOLS } from "@shared/ipc";
import { setRightPanelTab } from "./stores/right-panel-store";
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
import { openToolInRightPanel, RightPanel } from "./components/RightPanel";
import {
  SettingsPanel,
  type SettingsTab,
} from "./components/SettingsPanel";
import type { GodotSettingsSection } from "./components/settings/GodotSettingsPage";
import {
  appendAtPath,
  collapseFileBlocksToAtPaths,
  expandAtPathsInPrompt,
} from "./lib/expandAtPaths";
import { startersForProject } from "./lib/chat-starters";
import { normalizeProjectKey } from "./lib/group-sessions";
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
import { useAutoCompact } from "./hooks/useAutoCompact";
import { useProjectReadiness } from "./hooks/useProjectReadiness";
import { useRetractConfirm } from "./hooks/useRetractConfirm";
import { useUpdateStatus } from "./hooks/useUpdateStatus";
import { createEmptyState } from "./stores/chat-store";
import {
  clearSessionUsage,
  getCompacting,
  getSessionUsageState,
  getSessionUsageStoreVersion,
  setSessionUsage,
  subscribeSessionUsageStore,
} from "./stores/session-usage-store";

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function applyTheme(themeId: ThemeId, colorMode: ColorMode): void {
  document.body.dataset.theme = `${themeId}-${colorMode}`;
}

export default function App() {
  const confirm = useConfirm();
  const [items, setItems] = useState(createEmptyState());
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [cwd, setCwd] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
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
  const [goal, setGoal] = useState<GoalInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(
    undefined,
  );
  const [settingsGodotSection, setSettingsGodotSection] = useState<
    GodotSettingsSection | undefined
  >(undefined);
  const [queuedSteering, setQueuedSteering] = useState<string[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [followNonce, setFollowNonce] = useState(0);
  const [readyBusy, setReadyBusy] = useState(false);
  const [readyNotice, setReadyNotice] = useState<string | null>(null);
  const [prefsRecovery, setPrefsRecovery] =
    useState<PrefsRecoveryNotice | null>(null);
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
  const updateStatus = useUpdateStatus();

  const {
    isGodotProject,
    rpcStatus,
    docsStatus,
    setDocsStatus,
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

  const fetchSessionUsage = useCallback(() => {
    const gen = ++usageFetchGen.current;
    void window.xAgent.getSessionUsage().then((u) => {
      if (gen !== usageFetchGen.current) return;
      if (u) setSessionUsage(u);
      else setSessionUsage(null);
    });
  }, []);

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

  const refreshSessions = useCallback(async () => {
    const list = await window.xAgent.listSessions();
    setSessions(list);
  }, []);

  const refreshModels = useCallback(async () => {
    const list = await window.xAgent.listModels();
    setModels(list);
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

  const syncFromHost = useCallback(async () => {
    const s = await window.xAgent.getStatus();
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
              thinkingLevel: s.thinkingLevel,
            }
          : prev,
      );
    }
  }, [fetchSessionUsage, setConfirmState]);

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
    setPlanPath,
    setGoal,
    refreshSessions,
  });

  useEffect(() => {
    setReadyNotice(null);
  }, [cwd]);

  const chatStarters = useMemo(
    () => startersForProject(isGodotProject),
    [isGodotProject],
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
          const result = await window.xAgent.resumeSession(p.lastSessionPath);
          if (cancelled) return;
          if (result.ok) {
            setCwd(result.cwd);
            setSessionId(result.sessionId);
            restored = true;
            if (result.warning) setError(result.warning);
          }
        }
        if (!restored && p.lastProjectPath) {
          const result = await window.xAgent.openProject(p.lastProjectPath);
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
  }, [refreshModels, refreshSessions, syncFromHost]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsTab("general");
        setSettingsGodotSection(undefined);
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clearComposerEditState = useCallback(() => {
    setEditingEntryId(null);
    setEditDraft("");
    setConfirmState(null);
  }, []);

  const openProject = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.openProject();
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
  };

  const newSession = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.newSession();
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
  };

  const resumeSession = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.resumeSession(path);
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
  };

  const deleteSession = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.deleteSession(path);
      if (!result.ok) {
        setError(result.error ?? "删除失败");
        return;
      }
      await syncFromHost();
      await refreshSessions();
    } finally {
      setBusy(false);
    }
  };

  const deleteProjectSessions = async (projectCwd: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.deleteProjectSessions(projectCwd);
      if (!result.ok) {
        setError(result.error ?? "删除项目对话失败");
        return;
      }
      await syncFromHost();
      await refreshSessions();
    } finally {
      setBusy(false);
    }
  };

  const hideProject = async (projectCwd: string) => {
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
        const closed = await window.xAgent.closeWorkspace();
        if (!closed.ok) {
          setError(closed.error ?? "关闭工作区失败");
        }
        await syncFromHost();
      }
      await refreshSessions();
    } finally {
      setBusy(false);
    }
  };

  const renameSession = async (path: string, name: string) => {
    const result = await window.xAgent.renameSession(path, name);
    if (!result.ok) setError(result.error ?? "重命名失败");
    else await refreshSessions();
  };

  const addPathToChat = useCallback((relPath: string) => {
    setInput((prev) => appendAtPath(prev, relPath));
  }, []);

  const send = async () => {
    if (!input.trim() || !cwd) return;
    const text = input.trim();
    setInput("");
    setError(null);
    setFollowNonce((n) => n + 1);

    // Slash: /goal — host IPC, not model prompt.
    if (/^\/goal\s+clear\b/i.test(text) || /^\/goal\s*$/i.test(text)) {
      if (/clear/i.test(text)) {
        const result = await window.xAgent.clearGoal();
        if (!result.ok) setError(result.error ?? "清除目标失败");
        else {
          setGoal(null);
          setSessionMode("agent");
        }
      } else {
        const g = await window.xAgent.getGoal();
        setGoal(g);
        setError(
          g
            ? `目标 (${g.status}): ${g.condition}`
            : "当前无活跃目标。切换到「目标」模式后输入完成条件并发送。",
        );
      }
      return;
    }
    const goalSet = text.match(/^\/goal\s+(.+)$/is);
    if (goalSet?.[1] && !/^clear\b/i.test(goalSet[1].trim())) {
      const result = await window.xAgent.setGoal(goalSet[1].trim());
      if (!result.ok) setError(result.error ?? "设置目标失败");
      else {
        if (result.goal) setGoal(result.goal);
        setSessionMode("goal");
      }
      return;
    }

    // Goal 模式且尚未设置条件：整条消息即完成条件。
    if (sessionMode === "goal" && goal?.status !== "pursuing") {
      const result = await window.xAgent.setGoal(text);
      if (!result.ok) setError(result.error ?? "设置目标失败");
      else {
        if (result.goal) setGoal(result.goal);
        setSessionMode("goal");
      }
      return;
    }

    const expanded = await expandAtPathsInPrompt(text);
    const result = await window.xAgent.prompt(expanded);
    if (!result.ok) {
      setError(result.error ?? "发送失败");
    }
    await refreshSessions();
  };

  const onSessionModeChange = async (mode: AgentSessionMode) => {
    const result = await window.xAgent.setSessionMode(mode);
    if (!result.ok) {
      setError(result.error ?? "切换模式失败");
      return;
    }
    if (result.info) {
      setSessionMode(result.info.mode);
      setPlanPath(result.info.planPath);
    }
    if (mode === "agent" || mode === "plan") {
      setGoal(null);
      // 离开目标模式时清掉输入框里残留的 /goal 命令草稿
      setInput((prev) => (prev.trim().startsWith("/goal") ? "" : prev));
    }
    if (mode === "goal" && result.needGoalCondition) {
      // 不预填 /goal；仅清空误留的 slash 草稿，让用户直接写完成条件
      setInput((prev) => (prev.trim().startsWith("/goal") ? "" : prev));
      setFollowNonce((n) => n + 1);
    }
  };

  const onBuildPlan = async () => {
    setError(null);
    const result = await window.xAgent.buildPlan();
    if (!result.ok) setError(result.error ?? "执行计划失败");
    else {
      const mode = await window.xAgent.getSessionMode();
      setSessionMode(mode.mode);
      setPlanPath(mode.planPath);
    }
    await refreshSessions();
  };

  // write_plan / session_mode → open right-panel Plan tab for review.
  const prevPlanPathRef = useRef<string | null>(null);

  const onClearGoal = async () => {
    const result = await window.xAgent.clearGoal();
    if (!result.ok) setError(result.error ?? "清除目标失败");
    else {
      setGoal(null);
      setSessionMode("agent");
    }
  };

  const abort = async () => {
    await window.xAgent.abort();
  };

  const onStartEdit = (entryId: string, text: string) => {
    setEditingEntryId(entryId);
    setEditDraft(collapseFileBlocksToAtPaths(text));
  };

  const onCancelEdit = () => {
    setEditingEntryId(null);
    setEditDraft("");
  };

  const onConfirmEdit = () => {
    if (!editingEntryId || !editDraft.trim()) return;
    void beginConfirm("edit", editingEntryId, editDraft);
  };

  const onRetract = (entryId: string) => {
    void beginConfirm("retract", entryId);
  };

  const onRegenerate = (userEntryId: string) => {
    void beginConfirm("regenerate", userEntryId);
  };

  const onModelChange = async (value: string) => {
    const [provider, ...rest] = value.split("/");
    const id = rest.join("/");
    if (!provider || !id) return;
    const result = await window.xAgent.setModel(provider, id);
    if (!result.ok) setError(result.error ?? "切换模型失败");
    else {
      setPrefs((prev) => (prev ? { ...prev, provider, model: id } : prev));
    }
  };

  const onThinkingChange = async (level: ThinkingLevel) => {
    const result = await window.xAgent.setThinkingLevel(level);
    if (!result.ok) {
      setError("切换 Thinking 失败（请先打开项目）");
      return;
    }
    const next = await window.xAgent.getPrefs();
    setPrefs(next);
  };

  const toggleThinking = async () => {
    if (!prefs) return;
    const showThinking = !prefs.showThinking;
    setPrefs({ ...prefs, showThinking });
    const next = await window.xAgent.setPrefs({ showThinking });
    setPrefs(next);
  };

  const toggleTheme = async () => {
    if (!prefs) return;
    const colorMode = prefs.colorMode === "dark" ? "light" : "dark";
    const next = await window.xAgent.setPrefs({ colorMode });
    setPrefs(next);
    applyTheme(next.themeId, next.colorMode);
  };

  const commitSidebarWidth = useCallback(async (sidebarWidth: number) => {
    setPrefs((prev) => (prev ? { ...prev, sidebarWidth } : prev));
    const next = await window.xAgent.setPrefs({ sidebarWidth });
    setPrefs(next);
  }, []);

  const commitRightPanelWidth = useCallback(async (rightPanelWidth: number) => {
    setPrefs((prev) => (prev ? { ...prev, rightPanelWidth } : prev));
    const next = await window.xAgent.setPrefs({ rightPanelWidth });
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
    const next = await window.xAgent.setPrefs({ rightPanelOpen });
    setPrefs(next);
  };

  const ensureRightPanelOpen = async () => {
    if (!prefs || prefs.rightPanelOpen) return;
    setPrefs({ ...prefs, rightPanelOpen: true });
    const next = await window.xAgent.setPrefs({ rightPanelOpen: true });
    setPrefs(next);
  };

  useEffect(() => {
    const prev = prevPlanPathRef.current;
    prevPlanPathRef.current = planPath;
    if (!planPath || planPath === prev) return;
    setRightPanelTab("plan");
    void ensureRightPanelOpen();
    // Only react to planPath identity; open helpers read latest prefs via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planPath]);

  const toggleTool = async (tool: string) => {
    if (!prefs) return;
    if (sessionId) {
      const ok = await confirm({
        title: "更改工具白名单",
        message:
          "更改工具白名单会重建当前会话的系统提示与工具定义，导致 DeepSeek/API 前缀缓存失效（本会话后续轮次需重新积累命中）。\n\n确定继续？",
        confirmLabel: "继续",
        tone: "warn",
      });
      if (!ok) return;
    }
    const tools = prefs.tools.includes(tool)
      ? prefs.tools.filter((t) => t !== tool)
      : [...prefs.tools, tool];
    const next = await window.xAgent.setPrefs({ tools });
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
    setSettingsGodotSection(undefined);
    setSettingsOpen(true);
  };

  const openSettingsAt = (
    tab: SettingsTabTarget,
    godotSection?: GodotSettingsSection,
  ) => {
    setSettingsTab(tab);
    setSettingsGodotSection(godotSection);
    setSettingsOpen(true);
  };

  const muteReadyChecklist = async () => {
    if (!prefs || !projectKey) return;
    const keys = new Set(prefs.dismissedReadyChecklistKeys ?? []);
    keys.add(projectKey);
    const next = await window.xAgent.setPrefs({
      dismissedReadyChecklistKeys: [...keys],
    });
    setPrefs(next);
    setReadyChecklistHidden(true);
  };

  const dismissGodotToolsNudge = async () => {
    if (!prefs || !projectKey) return;
    const keys = new Set(prefs.dismissedGodotToolsNudgeKeys ?? []);
    keys.add(projectKey);
    const next = await window.xAgent.setPrefs({
      dismissedGodotToolsNudgeKeys: [...keys],
    });
    setPrefs(next);
  };

  const enableGodotEditorTools = async () => {
    if (!prefs) return;
    setReadyBusy(true);
    try {
      const without = prefs.tools.filter(
        (t) => !(GODOT_TOOLS as readonly string[]).includes(t),
      );
      const next = await window.xAgent.setPrefs({
        tools: [...without, ...GODOT_TOOLS],
      });
      setPrefs(next);
      await dismissGodotToolsNudge();
    } finally {
      setReadyBusy(false);
    }
  };

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
      } else if (status.running && (status.clients ?? 0) > 0) {
        setReadyNotice(`桥接已连接 Godot（${status.clients}）`);
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

  const pickStarter = (prompt: string) => {
    setInput(prompt);
  };

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
        models={models}
        currentModelKey={currentModelKey}
        thinkingLevel={prefs?.thinkingLevel ?? "high"}
        thinkingLevels={THINKING_LEVELS}
        showThinking={prefs?.showThinking ?? true}
        theme={prefs?.colorMode ?? "dark"}
        onOpenProject={openProject}
        onNewSession={newSession}
        onModelChange={onModelChange}
        onThinkingChange={onThinkingChange}
        onToggleThinking={toggleThinking}
        onToggleTheme={toggleTheme}
        onToggleRightPanel={toggleRightPanel}
        onOpenSettings={openSettings}
        onOpenUpdateSettings={() => openSettingsAt("general")}
        updateStatus={updateStatus}
        rightPanelOpen={prefs?.rightPanelOpen ?? false}
        compacting={compacting}
        busy={busy}
      />
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
          onResume={resumeSession}
          onDelete={deleteSession}
          onDeleteProjectSessions={(projectCwd) => {
            void deleteProjectSessions(projectCwd);
          }}
          onHideProject={(projectCwd) => {
            void hideProject(projectCwd);
          }}
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
                      openSettingsAt(
                        isGodotProject ? "godot" : "general",
                        isGodotProject ? "editor" : undefined,
                      ),
                  },
                ]
          }
          onPickStarter={pickStarter}
          onOpenToolInPanel={(toolId, args) => {
            openToolInRightPanel(toolId, args, () => {
              void ensureRightPanelOpen();
            });
          }}
          editingEntryId={editingEntryId}
          editDraft={editDraft}
          onEditDraftChange={setEditDraft}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onConfirmEdit={onConfirmEdit}
          onRetract={onRetract}
          onRegenerate={onRegenerate}
          sessionMode={sessionMode}
          planPath={planPath}
          goal={goal}
          onSessionModeChange={(mode) => {
            void onSessionModeChange(mode);
          }}
          onBuildPlan={() => {
            void onBuildPlan();
          }}
          onClearGoal={() => {
            void onClearGoal();
          }}
        />
        {prefs?.rightPanelOpen && (
          <RightPanel
            cwd={cwd}
            items={items}
            enabledTools={prefs?.tools ?? []}
            usage={sessionUsage}
            compacting={compacting}
            sessionId={sessionId}
            planPath={planPath}
            autoCompactPercent={prefs?.autoCompactPercent ?? 0}
            onAutoCompactPercentChange={(percent) => {
              void (async () => {
                const next = await window.xAgent.setPrefs({
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
          initialGodotSection={settingsGodotSection}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsTab(undefined);
            setSettingsGodotSection(undefined);
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
            const p = await window.xAgent.getPrefs();
            setPrefs(p);
            setAuth(await window.xAgent.checkAuth());
          }}
        />
      )}
    </div>
  );
}
