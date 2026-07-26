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
  FleetPairState,
  FleetSlotInfo,
  ModelInfo,
  PiCliStatus,
  SessionInfo,
  ThinkingLevel,
} from "@shared/ipc";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel, DualChatPanel } from "./components/ChatPanel";
import { TopBar } from "./components/TopBar";
import { FleetStrip } from "./components/FleetStrip";
import { openToolInRightPanel, RightPanel } from "./components/RightPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  RIGHT_PANEL_WIDTH_DEFAULT,
  RIGHT_PANEL_WIDTH_MAX,
  RIGHT_PANEL_WIDTH_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useColumnResize,
} from "./hooks/useColumnResize";
import {
  applySlotAgentEvent,
  createEmptyState,
  type ItemsBySlot,
} from "./stores/chat-store";

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

function slotRoleHint(role: FleetSlotInfo["role"]): string {
  if (role === "primary") return "主";
  if (role === "reviewer") return "审";
  return "工";
}

export default function App() {
  const [itemsBySlot, setItemsBySlot] = useState<ItemsBySlot>({});
  const [statusBySlot, setStatusBySlot] = useState<Record<string, AgentStatus>>(
    {},
  );
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
  const [queuedSteeringBySlot, setQueuedSteeringBySlot] = useState<
    Record<string, string[]>
  >({});
  const [fleetSlots, setFleetSlots] = useState<FleetSlotInfo[]>([]);
  const [fleetActiveId, setFleetActiveId] = useState<string | null>(null);
  const [fleetPair, setFleetPair] = useState<FleetPairState>({ phase: "idle" });
  const bottomRef = useRef<HTMLDivElement>(null);
  const workerBottomRef = useRef<HTMLDivElement>(null);
  const reviewerBottomRef = useRef<HTMLDivElement>(null);
  const fleetActiveIdRef = useRef<string | null>(null);

  useEffect(() => {
    fleetActiveIdRef.current = fleetActiveId;
  }, [fleetActiveId]);

  const currentModelKey = useMemo(() => {
    const m =
      prefs?.provider && prefs?.model ? `${prefs.provider}/${prefs.model}` : "";
    return m;
  }, [prefs]);

  const activeSlotId = fleetActiveId ?? "primary";
  const activeSlot =
    fleetSlots.find((s) => s.id === activeSlotId) ?? fleetSlots[0] ?? null;
  const activeItems = itemsBySlot[activeSlotId] ?? createEmptyState();
  const activeStatus = statusBySlot[activeSlotId] ?? status;
  const queuedSteering = queuedSteeringBySlot[activeSlotId] ?? [];

  const workerSlot =
    (fleetPair.workerSlotId
      ? fleetSlots.find((s) => s.id === fleetPair.workerSlotId)
      : undefined) ?? fleetSlots.find((s) => s.role === "worker");
  const reviewerSlot =
    (fleetPair.reviewerSlotId
      ? fleetSlots.find((s) => s.id === fleetPair.reviewerSlotId)
      : undefined) ?? fleetSlots.find((s) => s.role === "reviewer");
  const showDual = Boolean(
    workerSlot &&
      reviewerSlot &&
      activeSlot &&
      activeSlot.role !== "primary",
  );

  const pruneSlots = useCallback((slots: FleetSlotInfo[]) => {
    const ids = new Set(slots.map((s) => s.id));
    const pruneRecord = <T,>(
      prev: Record<string, T>,
    ): Record<string, T> => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (!ids.has(key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    };
    setItemsBySlot((prev) => pruneRecord(prev));
    setStatusBySlot((prev) => pruneRecord(prev));
    setQueuedSteeringBySlot((prev) => pruneRecord(prev));
  }, []);

  const refreshSessions = useCallback(async () => {
    const list = await window.xAgent.listSessions();
    setSessions(list);
  }, []);

  const refreshFleet = useCallback(async () => {
    const state = await window.xAgent.fleetState();
    setFleetSlots(state.slots);
    setFleetActiveId(state.activeId);
    setFleetPair(state.pair ?? { phase: "idle" });
    pruneSlots(state.slots);
  }, [pruneSlots]);

  const refreshModels = useCallback(async () => {
    const list = await window.xAgent.listModels();
    setModels(list);
  }, []);

  const syncFromHost = useCallback(async () => {
    const s = await window.xAgent.getStatus();
    const slotId = fleetActiveIdRef.current ?? "primary";
    setStatus(s.status);
    setStatusBySlot((prev) => ({ ...prev, [slotId]: s.status }));
    setCwd(s.cwd);
    setSessionId(s.sessionId);
    if (!s.hasSession) {
      setItemsBySlot((prev) => ({ ...prev, [slotId]: createEmptyState() }));
      setSessionId(null);
      setQueuedSteeringBySlot((prev) => ({ ...prev, [slotId]: [] }));
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
    return window.xAgent.onEvent((payload) => {
      const { slotId, event } = payload;
      const isActive = slotId === (fleetActiveIdRef.current ?? "primary");

      if (event.type === "status") {
        setStatusBySlot((prev) => ({ ...prev, [slotId]: event.status }));
        if (isActive) {
          setStatus(event.status);
          if (event.error) setError(event.error);
          else if (event.status === "idle" || event.status === "streaming") {
            setError(null);
          }
        }
        return;
      }
      if (event.type === "session_info") {
        if (isActive) {
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
        }
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
        setQueuedSteeringBySlot((prev) => ({
          ...prev,
          [slotId]: event.steering,
        }));
        return;
      }
      if (event.type === "history_replace") {
        setQueuedSteeringBySlot((prev) => ({ ...prev, [slotId]: [] }));
      }
      setItemsBySlot((prev) => applySlotAgentEvent(prev, payload));
    });
  }, [refreshSessions]);

  useEffect(() => {
    return window.xAgent.onFleetEvent((event) => {
      if (event.type === "slot_status") {
        setFleetSlots((prev) =>
          prev.map((s) =>
            s.id === event.slotId ? { ...s, busy: event.busy } : s,
          ),
        );
        setStatusBySlot((prev) => ({
          ...prev,
          [event.slotId]: event.status,
        }));
        return;
      }
      if (event.type === "pair_progress") {
        setFleetPair(event.pair);
        if (event.pair.phase === "error" && event.pair.message) {
          setError(event.pair.message);
        }
        return;
      }
      if (event.type === "state") {
        setFleetSlots(event.state.slots);
        setFleetActiveId(event.state.activeId);
        setFleetPair(event.state.pair ?? { phase: "idle" });
        pruneSlots(event.state.slots);
      }
    });
  }, [pruneSlots]);

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
      await refreshFleet();
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
      await refreshFleet();
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshFleet, refreshModels, refreshSessions, syncFromHost]);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";
    if (showDual) {
      workerBottomRef.current?.scrollIntoView({ behavior });
      reviewerBottomRef.current?.scrollIntoView({ behavior });
    } else {
      bottomRef.current?.scrollIntoView({ behavior });
    }
  }, [activeItems, activeStatus, showDual, itemsBySlot, statusBySlot]);

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
      await refreshFleet();
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

  const send = async () => {
    if (!input.trim() || !cwd) return;
    const text = input;
    setInput("");
    setError(null);
    const result = await window.xAgent.prompt(text);
    if (!result.ok) {
      setError(result.error ?? "发送失败");
    }
    await refreshSessions();
  };

  const abort = async () => {
    await window.xAgent.abort();
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

  const onOpenToolInPanelForSlot = (slotId: string) => {
    return (toolId: string, args: unknown) => {
      if (slotId !== activeSlotId) {
        void switchFleetSlot(slotId);
      }
      openToolInRightPanel(slotId, toolId, args, () => {
        void ensureRightPanelOpen();
      });
    };
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

  const switchFleetSlot = async (id: string) => {
    if (id === fleetActiveId) return;
    const previousId = fleetActiveId;
    // Optimistic: so resyncUi session_info/history pass isActive gates.
    fleetActiveIdRef.current = id;
    setFleetActiveId(id);
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.fleetSetActive(id);
      if (!result.ok) {
        fleetActiveIdRef.current = previousId;
        setFleetActiveId(previousId);
        setError(result.error ?? "切换 Fleet 槽位失败");
        return;
      }
      await refreshFleet();
      await syncFromHost();
      await refreshSessions();
    } finally {
      setBusy(false);
    }
  };

  const addFleetWorker = async () => {
    setBusy(true);
    setError(null);
    try {
      const n = fleetSlots.filter((s) => s.role === "worker").length + 1;
      await window.xAgent.fleetCreate(
        n === 1 ? "实现" : `实现 ${n}`,
        "worker",
      );
      await refreshFleet();
      await refreshSessions();
    } finally {
      setBusy(false);
    }
  };

  const addFleetReviewer = async () => {
    setBusy(true);
    setError(null);
    try {
      const n = fleetSlots.filter((s) => s.role === "reviewer").length + 1;
      await window.xAgent.fleetCreate(
        n === 1 ? "审阅" : `审阅 ${n}`,
        "reviewer",
      );
      await refreshFleet();
      await refreshSessions();
    } finally {
      setBusy(false);
    }
  };

  const removeFleetSlot = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.fleetRemove(id);
      if (!result.ok) {
        setError(result.error ?? "移除 Fleet 槽位失败");
        return;
      }
      await refreshFleet();
      await syncFromHost();
      await refreshSessions();
    } finally {
      setBusy(false);
    }
  };

  const startFleetPair = async () => {
    if (!input.trim() || !cwd) return;
    const task = input;
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.fleetStartPair(task);
      if (!result.ok) {
        setInput(task);
        setError(result.error ?? "启动并行编排失败");
        return;
      }
      if (result.pair) setFleetPair(result.pair);
      // Jump to worker so dual-pane 实现|审阅 shows immediately.
      if (result.pair?.workerSlotId) {
        const wid = result.pair.workerSlotId;
        fleetActiveIdRef.current = wid;
        setFleetActiveId(wid);
        await window.xAgent.fleetSetActive(wid);
      }
      await refreshFleet();
      await syncFromHost();
      await refreshSessions();
    } finally {
      setBusy(false);
    }
  };

  const abortFleetPair = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.xAgent.fleetAbortPair();
      if (!result.ok) {
        setError(result.error ?? "中止并行编排失败");
        return;
      }
      if (result.pair) setFleetPair(result.pair);
      await refreshFleet();
      await syncFromHost();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <TopBar
        cwd={cwd}
        status={activeStatus}
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
      <FleetStrip
        slots={fleetSlots}
        activeId={fleetActiveId}
        busy={busy}
        pair={fleetPair}
        onSelect={switchFleetSlot}
        onAddWorker={addFleetWorker}
        onAddReviewer={addFleetReviewer}
        onRemove={removeFleetSlot}
        onAbortPair={abortFleetPair}
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
          agentStatus={activeStatus}
          busy={busy}
          onResume={resumeSession}
          onDelete={deleteSession}
          onRename={renameSession}
          onRefresh={refreshSessions}
          onResizePointerDown={onSidebarResizePointerDown}
          onResizeDoubleClick={onSidebarResizeDoubleClick}
          resizing={sidebarResizing}
        />
        {showDual && workerSlot && reviewerSlot ? (
          <DualChatPanel
            workerTitle={workerSlot.label}
            reviewerTitle={reviewerSlot.label}
            workerItems={itemsBySlot[workerSlot.id] ?? createEmptyState()}
            reviewerItems={itemsBySlot[reviewerSlot.id] ?? createEmptyState()}
            workerStatus={statusBySlot[workerSlot.id] ?? "idle"}
            reviewerStatus={statusBySlot[reviewerSlot.id] ?? "idle"}
            activeRole={
              activeSlot?.role === "reviewer" ? "reviewer" : "worker"
            }
            showThinking={prefs?.showThinking ?? true}
            input={input}
            setInput={setInput}
            onSend={send}
            onAbort={abort}
            onStartPair={startFleetPair}
            pairActive={
              fleetPair.phase === "wave1" || fleetPair.phase === "wave2"
            }
            disabled={!cwd}
            queuedSteering={queuedSteering}
            onFocusWorker={() => void switchFleetSlot(workerSlot.id)}
            onFocusReviewer={() => void switchFleetSlot(reviewerSlot.id)}
            workerBottomRef={workerBottomRef}
            reviewerBottomRef={reviewerBottomRef}
            onOpenToolInPanelWorker={
              workerSlot
                ? onOpenToolInPanelForSlot(workerSlot.id)
                : undefined
            }
            onOpenToolInPanelReviewer={
              reviewerSlot
                ? onOpenToolInPanelForSlot(reviewerSlot.id)
                : undefined
            }
          />
        ) : (
          <ChatPanel
            title={activeSlot?.label ?? "主会话"}
            roleHint={slotRoleHint(activeSlot?.role ?? "primary")}
            items={activeItems}
            showThinking={prefs?.showThinking ?? true}
            status={activeStatus}
            input={input}
            setInput={setInput}
            onSend={send}
            onAbort={abort}
            onStartPair={startFleetPair}
            pairActive={
              fleetPair.phase === "wave1" || fleetPair.phase === "wave2"
            }
            disabled={!cwd}
            queuedSteering={queuedSteering}
            bottomRef={bottomRef}
            onOpenToolInPanel={onOpenToolInPanelForSlot(activeSlotId)}
          />
        )}
        {prefs?.rightPanelOpen && (
          <RightPanel
            slotId={activeSlotId}
            cwd={cwd}
            items={activeItems}
            onClose={() => void toggleRightPanel()}
            onResizePointerDown={onRightPanelResizePointerDown}
            onResizeDoubleClick={onRightPanelResizeDoubleClick}
            resizing={rightPanelResizing}
          />
        )}
      </div>
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
