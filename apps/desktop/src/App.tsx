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
  AgentStatus,
  AuthStatus,
  BashCheckResult,
  ClientPrefs,
  ColorMode,
  ModelInfo,
  PiCliStatus,
  SessionInfo,
  ThemeId,
  ThinkingLevel,
} from "@shared/ipc";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { RetractConfirmModal } from "./components/RetractConfirmModal";
import { TopBar } from "./components/TopBar";
import { openToolInRightPanel, RightPanel } from "./components/RightPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  appendAtPath,
  expandAtPathsInPrompt,
} from "./lib/expandAtPaths";
import { normalizeProjectKey } from "./lib/group-sessions";
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
import { useRetractConfirm } from "./hooks/useRetractConfirm";
import { createEmptyState } from "./stores/chat-store";
import {
  clearSessionUsage,
  getCompacting,
  getSessionUsageState,
  getSessionUsageStoreVersion,
  setSessionUsage,
  subscribeSessionUsageStore,
} from "./stores/session-usage-store";

type SettingsTab =
  | "general"
  | "providers"
  | "tools"
  | "plugins"
  | "godot"
  | "usage";

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
  const [items, setItems] = useState(createEmptyState());
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [cwd, setCwd] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [prefs, setPrefs] = useState<ClientPrefs | null>(null);
  const [bash, setBash] = useState<BashCheckResult | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [piCli, setPiCli] = useState<PiCliStatus | null>(null);
  const [piCliInstalling, setPiCliInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(
    undefined,
  );
  const [queuedSteering, setQueuedSteering] = useState<string[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [followNonce, setFollowNonce] = useState(0);
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
    refreshSessions,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await window.xAgent.getPrefs();
      if (cancelled) return;
      setPrefs(p);
      applyTheme(p.themeId, p.colorMode);
      setBash(await window.xAgent.checkBash());
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
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshModels, refreshSessions, syncFromHost]);

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
    const text = input;
    setInput("");
    setError(null);
    setFollowNonce((n) => n + 1);
    const expanded = await expandAtPathsInPrompt(text);
    const result = await window.xAgent.prompt(expanded);
    if (!result.ok) {
      setError(result.error ?? "发送失败");
    }
    await refreshSessions();
  };

  const abort = async () => {
    await window.xAgent.abort();
  };

  const onStartEdit = (entryId: string, text: string) => {
    setEditingEntryId(entryId);
    setEditDraft(text);
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
    setPrefs((prev) => (prev ? { ...prev, thinkingLevel: level } : prev));
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

  const toggleTool = async (tool: string) => {
    if (!prefs) return;
    if (sessionId) {
      const ok = window.confirm(
        "更改工具白名单会重建当前会话的系统提示与工具定义，导致 DeepSeek/API 前缀缓存失效（本会话后续轮次需重新积累命中）。\n\n确定继续？",
      );
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

  const openProviderSettings = () => {
    setSettingsTab("providers");
    setSettingsOpen(true);
  };

  const openSettings = () => {
    setSettingsTab(undefined);
    setSettingsOpen(true);
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
        thinkingLevel={prefs?.thinkingLevel ?? "medium"}
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
        rightPanelOpen={prefs?.rightPanelOpen ?? false}
        compacting={compacting}
        busy={busy}
      />
      {piCli && !piCli.ok && (
        <div className="banner warn">
          <AlertTriangle size={14} />
          <span>{piCliInstalling ? "正在安装 Pi CLI…" : piCli.message}</span>
          {piCli.canInstall && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={installPi}
              disabled={piCliInstalling}
            >
              {piCliInstalling ? "安装中…" : "安装 Pi CLI"}
            </button>
          )}
        </div>
      )}
      {auth && !auth.ok && (
        <div className="banner warn">
          <AlertTriangle size={14} />
          <span>{auth.message}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void openPiLogin()}
          >
            打开 Pi 登录
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={openProviderSettings}
          >
            配置供应商
          </button>
        </div>
      )}
      {models.length === 0 && auth?.ok && (
        <div className="banner warn">
          <AlertTriangle size={14} />
          <span>无可用模型。请检查 ~/.pi/agent/models.json 与认证配置。</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={openProviderSettings}
          >
            配置供应商
          </button>
        </div>
      )}
      {!bash?.ok && bash && (
        <div className="banner warn">
          <AlertTriangle size={14} />
          <span>{bash.message}</span>
          {bash.suggestedShellPath && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={applyBash}>
              写入 shellPath
            </button>
          )}
        </div>
      )}
      {bash?.ok && bash.suggestedShellPath && bash.message.includes("可写入") && (
        <div className="banner warn">
          <AlertTriangle size={14} />
          <span>已检测到 bash，但尚未写入 Pi settings。</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={applyBash}>
            写入 shellPath
          </button>
        </div>
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
        />
        {prefs?.rightPanelOpen && (
          <RightPanel
            cwd={cwd}
            items={items}
            enabledTools={prefs?.tools ?? []}
            usage={sessionUsage}
            compacting={compacting}
            sessionId={sessionId}
            busy={
              busy ||
              status === "streaming" ||
              status === "retrying" ||
              retractBusy
            }
            onClose={() => void toggleRightPanel()}
            onAddPathToChat={addPathToChat}
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
