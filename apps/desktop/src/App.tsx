import { AlertTriangle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  AgentStatus,
  AuthStatus,
  BashCheckResult,
  ClientPrefs,
  ModelInfo,
  PiCliStatus,
  RetractPreview,
  SessionInfo,
  ThinkingLevel,
} from "@shared/ipc";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import {
  RetractConfirmModal,
  type RetractConfirmMode,
} from "./components/RetractConfirmModal";
import { TopBar } from "./components/TopBar";
import { openToolInRightPanel, RightPanel } from "./components/RightPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  appendAtPath,
  expandAtPathsInPrompt,
} from "./lib/expandAtPaths";
import {
  RIGHT_PANEL_WIDTH_DEFAULT,
  RIGHT_PANEL_WIDTH_MAX,
  RIGHT_PANEL_WIDTH_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useColumnResize,
} from "./hooks/useColumnResize";
import { applyAgentEvent, createEmptyState } from "./stores/chat-store";

type SettingsTab = "general" | "providers" | "tools" | "plugins" | "godot";

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function applyTheme(theme: "light" | "dark"): void {
  document.body.dataset.theme = theme;
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
  const [retractBusy, setRetractBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    mode: RetractConfirmMode;
    entryId: string;
    preview: RetractPreview;
    editText?: string;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  const syncFromHost = useCallback(async () => {
    const s = await window.xAgent.getStatus();
    setStatus(s.status);
    setCwd(s.cwd);
    setSessionId(s.sessionId);
    if (!s.hasSession) {
      setItems(createEmptyState());
      setSessionId(null);
      setQueuedSteering([]);
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
  }, []);

  useEffect(() => {
    return window.xAgent.onEvent((event) => {
      if (event.type === "status") {
        setStatus(event.status);
        if (event.error) setError(event.error);
        else if (event.status === "idle" || event.status === "streaming") {
          setError(null);
        }
        return;
      }
      if (event.type === "session_info") {
        setCwd(event.cwd);
        setSessionId(event.sessionId);
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
      if (event.type === "queue_update") {
        setQueuedSteering(event.steering);
        return;
      }
      if (event.type === "history_replace") {
        setQueuedSteering([]);
      }
      setItems((prev) => applyAgentEvent(prev, event));
    });
  }, [refreshSessions]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await window.xAgent.getPrefs();
      if (cancelled) return;
      setPrefs(p);
      applyTheme(p.theme);
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

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";
    bottomRef.current?.scrollIntoView({ behavior });
  }, [items, status]);

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
      setCwd(result.cwd);
      setSessionId(result.sessionId);
      if (result.warning) setError(result.warning);
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
      setSessionId(result.sessionId);
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
      setCwd(result.cwd);
      setSessionId(result.sessionId);
      if (result.warning) setError(result.warning);
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

  const beginConfirm = async (
    mode: RetractConfirmMode,
    entryId: string,
    editText?: string,
  ) => {
    setError(null);
    const preview = await window.xAgent.previewRetract(entryId);
    if (!preview.ok) {
      setError(preview.error ?? "无法预览撤回");
      return;
    }
    setConfirmState({ mode, entryId, preview, editText });
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

  const runConfirmedRetract = async () => {
    if (!confirmState) return;
    setRetractBusy(true);
    setError(null);
    try {
      const { mode, entryId, editText } = confirmState;
      let result;
      if (mode === "retract") {
        result = await window.xAgent.retractToUserMessage(entryId, {
          undoFiles: true,
        });
      } else if (mode === "edit") {
        const expanded = await expandAtPathsInPrompt(editText ?? editDraft);
        result = await window.xAgent.editAndResend(entryId, expanded, {
          undoFiles: true,
        });
      } else {
        result = await window.xAgent.regenerateFromUser(entryId, {
          undoFiles: true,
        });
      }

      if (!result.ok) {
        setError(result.error ?? "操作失败");
        return;
      }

      if (mode === "retract") {
        const text =
          result.editorText?.trim() ||
          confirmState.preview.editorText?.trim() ||
          "";
        if (text) setInput(text);
      }

      const report = result.restoreReport;
      if (report?.warnings?.length) {
        setError(report.warnings.join(" "));
      }

      setConfirmState(null);
      setEditingEntryId(null);
      setEditDraft("");
      await refreshSessions();
    } finally {
      setRetractBusy(false);
    }
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
    const theme = prefs.theme === "dark" ? "light" : "dark";
    const next = await window.xAgent.setPrefs({ theme });
    setPrefs(next);
    applyTheme(next.theme);
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
        theme={prefs?.theme ?? "dark"}
        onOpenProject={openProject}
        onNewSession={newSession}
        onModelChange={onModelChange}
        onThinkingChange={onThinkingChange}
        onToggleThinking={toggleThinking}
        onToggleTheme={toggleTheme}
        onToggleRightPanel={toggleRightPanel}
        onOpenSettings={openSettings}
        rightPanelOpen={prefs?.rightPanelOpen ?? false}
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
            "--sidebar-width": `${sidebarWidth}px`,
            "--right-panel-width": `${rightPanelWidth}px`,
          } as CSSProperties
        }
      >
        <Sidebar
          sessions={sessions}
          activeSessionId={sessionId}
          activeCwd={cwd}
          agentStatus={status}
          busy={busy}
          onResume={resumeSession}
          onDelete={deleteSession}
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
          queuedSteering={queuedSteering}
          bottomRef={bottomRef}
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
            if (!retractBusy) setConfirmState(null);
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
          onPrefsChanged={(p) => {
            setPrefs(p);
            applyTheme(p.theme);
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
