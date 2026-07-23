import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentStatus,
  AuthStatus,
  BashCheckResult,
  ClientPrefs,
  ModelInfo,
  SessionInfo,
  ThinkingLevel,
  UiAgentEvent,
} from "@shared/ipc";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { TopBar } from "./components/TopBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { PluginsPage } from "./components/PluginsPage";
import { ChatItem, applyAgentEvent } from "./stores/chat-store";

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
  const [items, setItems] = useState<ChatItem[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [cwd, setCwd] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [prefs, setPrefs] = useState<ClientPrefs | null>(null);
  const [bash, setBash] = useState<BashCheckResult | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<"chat" | "plugins">("chat");
  const [queuedSteering, setQueuedSteering] = useState<string[]>([]);
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
      setItems([]);
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
      if (event.type === "queue_update") {
        setQueuedSteering(event.steering);
        return;
      }
      if (event.type === "history_replace") {
        setQueuedSteering([]);
      }
      setItems((prev) => applyAgentEvent(prev, event));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await window.xAgent.getPrefs();
      if (cancelled) return;
      setPrefs(p);
      applyTheme(p.theme);
      setBash(await window.xAgent.checkBash());
      setAuth(await window.xAgent.checkAuth());
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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

  return (
    <div className="app-shell">
      {view === "plugins" ? (
        <PluginsPage cwd={cwd} onBack={() => setView("chat")} />
      ) : (
        <>
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
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenPlugins={() => setView("plugins")}
        busy={busy}
      />
      {auth && !auth.ok && (
        <div className="banner warn">
          <AlertTriangle size={14} />
          {auth.message}
        </div>
      )}
      {models.length === 0 && auth?.ok && (
        <div className="banner warn">
          <AlertTriangle size={14} />
          无可用模型。请检查 ~/.pi/agent/models.json 与认证配置。
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
      <div className="main-row">
        <Sidebar
          sessions={sessions}
          activeSessionId={sessionId}
          agentStatus={status}
          busy={busy}
          onResume={resumeSession}
          onDelete={deleteSession}
          onRename={renameSession}
          onRefresh={refreshSessions}
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
        />
      </div>
      {prefs && (
        <SettingsPanel
          open={settingsOpen}
          prefs={prefs}
          onClose={() => setSettingsOpen(false)}
          onToggleTool={toggleTool}
          onPrefsChanged={setPrefs}
          onProvidersChanged={async () => {
            await refreshModels();
            const p = await window.xAgent.getPrefs();
            setPrefs(p);
          }}
        />
      )}
        </>
      )}
    </div>
  );
}
