import type { BrowserWindow } from "electron";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  AgentStatus,
  HistoryItem,
  HostStatus,
  ModelInfo,
  OpenProjectResult,
  PromptResult,
  SessionInfo,
  ThinkingLevel,
  UiAgentEvent,
} from "../../shared/ipc";
import { getAgentDirPath, loadPrefs, patchPrefs } from "./prefs";
import { messagesToHistory } from "./history";
import { getXAgentSessionsRoot, isXAgentSessionPath } from "./session-paths";
import { deriveSessionTitle, displaySessionName } from "./session-title";
import type { GodotRpcBridge } from "./godot-rpc-bridge";
import { createGodotTools } from "./godot-tools";

type SessionBundle = {
  session: AgentSession;
  unsubscribe: () => void;
  cwd: string;
  sessionPath: string | null;
};

const TOOL_DETAIL_MAX_CHARS = 256 * 1024;

export type ToolDetailRecord = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  done: boolean;
  truncated?: boolean;
};

function truncate(value: unknown, max = 4000): unknown {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (!text) return value;
    if (text.length <= max) return value;
    return `${text.slice(0, max)}\n…(截断 ${text.length - max} 字符)`;
  } catch {
    return String(value);
  }
}

function serializeForDetail(value: unknown): { value: unknown; truncated: boolean } {
  try {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (!text) return { value, truncated: false };
    if (text.length <= TOOL_DETAIL_MAX_CHARS) {
      return { value, truncated: false };
    }
    return {
      value: `${text.slice(0, TOOL_DETAIL_MAX_CHARS)}\n…(截断 ${text.length - TOOL_DETAIL_MAX_CHARS} 字符)`,
      truncated: true,
    };
  } catch {
    return { value: String(value), truncated: false };
  }
}

function modelFromSession(session: AgentSession): ModelInfo | null {
  const model = session.model;
  if (!model) return null;
  return {
    provider: model.provider,
    id: model.id,
    name: (model as { name?: string }).name ?? model.id,
  };
}

function failOpen(
  error: string,
  cwd = "",
): OpenProjectResult {
  return {
    ok: false,
    cwd,
    sessionId: "",
    model: null,
    thinkingLevel: "off",
    error,
  };
}

export class SessionHost {
  private bundle: SessionBundle | null = null;
  private modelRuntime: ModelRuntime | null = null;
  private status: AgentStatus = "idle";
  private lastError: string | undefined;
  private getWindow: () => BrowserWindow | null;
  private godotRpc: GodotRpcBridge | null;
  /** Fleet injects sink so every slot can stream with a slotId tag. */
  private eventSink: ((event: UiAgentEvent) => void) | null = null;
  /** True when this host is the Fleet active slot (prefs / last-session only). */
  private isActiveSlot: () => boolean = () => true;
  /** Always notified (even when inactive) — for Fleet strip busy dots. */
  private statusListeners = new Set<(status: AgentStatus) => void>();
  /** Always notified for agent_start / agent_end — Fleet pair Wave2 handoff. */
  private lifecycleListeners = new Set<
    (event: { type: "agent_start" | "agent_end"; willRetry?: boolean }) => void
  >();
  /** Serializes session create/replace/dispose only — not prompt/abort. */
  private replaceChain: Promise<void> = Promise.resolve();
  private messageSeq = 0;
  private idCache = new WeakMap<object, string>();
  /** Untruncated (capped) tool payloads for right-panel detail view. */
  private toolDetails = new Map<string, ToolDetailRecord>();

  constructor(
    getWindow: () => BrowserWindow | null,
    godotRpc: GodotRpcBridge | null = null,
  ) {
    this.getWindow = getWindow;
    this.godotRpc = godotRpc;
  }

  getToolDetail(toolCallId: string): ToolDetailRecord | null {
    return this.toolDetails.get(toolCallId) ?? null;
  }

  /** Fleet: route all UI events through the manager (tagged with slotId). */
  setEventSink(fn: (event: UiAgentEvent) => void): void {
    this.eventSink = fn;
  }

  /** Fleet: whether this slot is the active composer target. */
  setActiveSlotCheck(fn: () => boolean): void {
    this.isActiveSlot = fn;
  }

  /** Fleet: status changes for inactive slots (busy indicators). */
  onStatusChange(fn: (status: AgentStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  /** Fleet orchestrator: listen for agent lifecycle without UI gating. */
  onLifecycle(
    fn: (event: { type: "agent_start" | "agent_end"; willRetry?: boolean }) => void,
  ): () => void {
    this.lifecycleListeners.add(fn);
    return () => {
      this.lifecycleListeners.delete(fn);
    };
  }

  getHistorySnapshot(): HistoryItem[] {
    if (!this.bundle) return [];
    return messagesToHistory(this.bundle.session.messages);
  }

  /** Push current history + session_info + status to the renderer (active slot). */
  resyncUi(): void {
    const status = this.getStatus();
    if (this.bundle) {
      this.emit({
        type: "session_info",
        sessionId: this.bundle.session.sessionId,
        cwd: this.bundle.cwd,
        model: modelFromSession(this.bundle.session),
        thinkingLevel: this.bundle.session.thinkingLevel as ThinkingLevel,
        sessionPath: this.bundle.sessionPath,
      });
    }
    this.emit({ type: "history_replace", items: this.getHistorySnapshot() });
    this.emit({
      type: "status",
      status: status.status,
      ...(status.error ? { error: status.error } : {}),
    });
  }

  private runReplaceExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.replaceChain.then(fn, fn);
    this.replaceChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private emit(event: UiAgentEvent): void {
    if (this.eventSink) {
      this.eventSink(event);
      return;
    }
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("agent:event", {
        slotId: "primary",
        event,
      });
    }
  }

  private setStatus(status: AgentStatus, error?: string): void {
    this.status = status;
    if (error !== undefined) {
      this.lastError = error;
    } else if (status === "idle" || status === "streaming" || status === "retrying") {
      this.lastError = undefined;
    }
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // ignore listener errors
      }
    }
    this.emit({
      type: "status",
      status,
      ...(this.lastError ? { error: this.lastError } : {}),
    });
  }

  private notifyLifecycle(event: {
    type: "agent_start" | "agent_end";
    willRetry?: boolean;
  }): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch {
        // ignore listener errors
      }
    }
  }

  private messageIdFrom(message: unknown): string {
    if (message && typeof message === "object") {
      const cached = this.idCache.get(message as object);
      if (cached) return cached;

      const m = message as { id?: string; timestamp?: string | number };
      let id: string;
      if (m.id) {
        id = String(m.id);
      } else if (m.timestamp != null && m.timestamp !== "") {
        id = `ts-${m.timestamp}`;
      } else {
        this.messageSeq += 1;
        id = `msg-${this.messageSeq}`;
      }
      this.idCache.set(message as object, id);
      return id;
    }
    this.messageSeq += 1;
    return `msg-${this.messageSeq}`;
  }

  private bridgeEvents(session: AgentSession): () => void {
    return session.subscribe((event) => {
      switch (event.type) {
        case "agent_start":
          this.setStatus("streaming");
          this.notifyLifecycle({ type: "agent_start" });
          this.emit({ type: "agent_start" });
          break;
        case "agent_end": {
          const willRetry = Boolean(
            (event as { willRetry?: boolean }).willRetry,
          );
          if (willRetry) {
            this.setStatus("retrying");
          } else {
            this.setStatus("idle");
            this.maybeAutoTitleSession();
          }
          this.notifyLifecycle({ type: "agent_end", willRetry });
          this.emit({ type: "agent_end", willRetry });
          break;
        }
        case "turn_start":
          this.emit({ type: "turn_start" });
          break;
        case "turn_end":
          this.emit({ type: "turn_end" });
          break;
        case "message_start": {
          const msg = event.message as {
            role?: string;
            stopReason?: string;
            errorMessage?: string;
          };
          if (msg.role === "assistant") {
            this.emit({
              type: "assistant_start",
              messageId: this.messageIdFrom(event.message),
            });
          } else if (msg.role === "user") {
            const text = this.extractUserText(event.message);
            if (text) {
              this.emit({
                type: "user_message",
                text,
                id: this.messageIdFrom(event.message),
              });
            }
          }
          break;
        }
        case "message_update": {
          const ame = event.assistantMessageEvent as {
            type?: string;
            delta?: string;
          };
          const id = this.messageIdFrom(event.message);
          if (ame?.type === "text_delta" && ame.delta) {
            this.emit({ type: "text_delta", messageId: id, delta: ame.delta });
          } else if (ame?.type === "thinking_delta" && ame.delta) {
            this.emit({
              type: "thinking_delta",
              messageId: id,
              delta: ame.delta,
            });
          }
          break;
        }
        case "message_end": {
          const msg = event.message as {
            role?: string;
            stopReason?: string;
            errorMessage?: string;
          };
          if (msg.role === "assistant") {
            const isError =
              msg.stopReason === "error" || Boolean(msg.errorMessage);
            this.emit({
              type: "assistant_end",
              messageId: this.messageIdFrom(event.message),
              isError,
              errorMessage: msg.errorMessage,
            });
            if (isError && msg.errorMessage) {
              this.setStatus("error", msg.errorMessage);
            }
          }
          break;
        }
        case "tool_execution_start": {
          const argsPack = serializeForDetail(event.args);
          this.toolDetails.set(event.toolCallId, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: argsPack.value,
            done: false,
            truncated: argsPack.truncated,
          });
          this.emit({
            type: "tool_start",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: truncate(event.args, 2000),
          });
          break;
        }
        case "tool_execution_update": {
          const prev = this.toolDetails.get(event.toolCallId);
          if (prev) {
            const pack = serializeForDetail(event.partialResult);
            this.toolDetails.set(event.toolCallId, {
              ...prev,
              result: pack.value,
              truncated: prev.truncated || pack.truncated,
            });
          }
          this.emit({
            type: "tool_update",
            toolCallId: event.toolCallId,
            partialResult: truncate(event.partialResult, 2000),
          });
          break;
        }
        case "tool_execution_end": {
          const prevDetail = this.toolDetails.get(event.toolCallId);
          const argsPack = serializeForDetail(prevDetail?.args);
          const resultPack = serializeForDetail(event.result);
          this.toolDetails.set(event.toolCallId, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: argsPack.value,
            result: resultPack.value,
            isError: event.isError,
            done: true,
            truncated: Boolean(prevDetail?.truncated) || resultPack.truncated,
          });
          this.emit({
            type: "tool_end",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: truncate(event.result, 4000),
            isError: event.isError,
          });
          break;
        }
        case "queue_update":
          this.emit({
            type: "queue_update",
            steering: [...(event.steering ?? [])],
            followUp: [...(event.followUp ?? [])],
          });
          break;
        case "auto_retry_start":
          this.setStatus("retrying");
          this.emit({
            type: "auto_retry",
            phase: "start",
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            message: event.errorMessage,
          });
          break;
        case "auto_retry_end":
          this.setStatus(event.success ? "streaming" : "error");
          if (!event.success && event.finalError) {
            this.lastError = event.finalError;
          }
          this.emit({
            type: "auto_retry",
            phase: "end",
            attempt: event.attempt,
            success: event.success,
            message: event.finalError,
          });
          break;
        default:
          break;
      }
    });
  }

  private extractUserText(message: unknown): string {
    if (!message || typeof message !== "object") return "";
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content
      .filter(
        (p): p is { type?: string; text?: string } =>
          !!p && typeof p === "object",
      )
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("")
      .trim();
  }

  /**
   * After the first completed round, persist a human-readable title once.
   * Skips if the user (or a prior auto-title) already set session_info.name.
   */
  private maybeAutoTitleSession(): void {
    const bundle = this.bundle;
    if (!bundle) return;
    if (bundle.session.sessionManager.getSessionName()) return;

    const messages = bundle.session.messages as readonly unknown[];
    let userText = "";
    let assistantText = "";
    for (const msg of messages) {
      const role = (msg as { role?: string }).role;
      if (!userText && role === "user") {
        userText = this.extractUserText(msg);
      } else if (userText && !assistantText && role === "assistant") {
        assistantText = this.extractUserText(msg);
        break;
      }
    }
    if (!userText && !assistantText) return;

    const title = deriveSessionTitle(userText, assistantText);
    if (!title.trim()) return;

    try {
      bundle.session.setSessionName(title);
      this.emit({
        type: "session_title",
        sessionId: bundle.session.sessionId,
        name: title,
        sessionPath: bundle.sessionPath,
      });
    } catch {
      // Non-fatal: listSessions still falls back to firstMessage.
    }
  }

  private async ensureRuntime(): Promise<ModelRuntime> {
    if (!this.modelRuntime) {
      const dir = getAgentDirPath();
      this.modelRuntime = await ModelRuntime.create({
        authPath: join(dir, "auth.json"),
        modelsPath: join(dir, "models.json"),
      });
    }
    return this.modelRuntime;
  }

  async reloadRuntime(): Promise<void> {
    if (this.modelRuntime) {
      try {
        await this.modelRuntime.reloadConfig();
        return;
      } catch {
        // fall through to recreate
      }
    }
    this.modelRuntime = null;
    await this.ensureRuntime();
  }

  /**
   * After provider profile activation: reload credentials/models and optionally switch session model.
   */
  async applyActivatedProvider(
    provider: string,
    modelId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.reloadRuntime();
      if (this.bundle) {
        const runtime = await this.ensureRuntime();
        const model = runtime.getModel(provider, modelId);
        if (model) {
          await this.bundle.session.setModel(model);
          this.emit({
            type: "session_info",
            sessionId: this.bundle.session.sessionId,
            cwd: this.bundle.cwd,
            model: modelFromSession(this.bundle.session),
            thinkingLevel: this.bundle.session.thinkingLevel as ThinkingLevel,
            sessionPath: this.bundle.sessionPath,
          });
        }
      }
      this.emit({
        type: "notice",
        text: `已启用供应商 ${provider} / ${modelId}`,
        level: "info",
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private sessionFileOf(session: AgentSession): string | null {
    const file = (session as { sessionFile?: string | null }).sessionFile;
    return file ?? null;
  }

  private async disposeBundle(bundle: SessionBundle | null): Promise<void> {
    if (!bundle) return;
    try {
      if (bundle.session.isStreaming) {
        await bundle.session.abort();
      }
    } catch {
      // ignore
    }
    try {
      bundle.unsubscribe();
      bundle.session.dispose();
    } catch {
      // ignore
    }
    // Drop tool detail cache so IDs from a prior session cannot leak into the panel.
    this.toolDetails.clear();
  }

  private async createSession(
    cwd: string,
    sessionManager: SessionManager,
  ): Promise<OpenProjectResult> {
    const prefs = loadPrefs();
    const modelRuntime = await this.ensureRuntime();
    const agentDir = getAgentDir();
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
    });
    await loader.reload();

    let selectedModel =
      prefs.provider && prefs.model
        ? modelRuntime.getModel(prefs.provider, prefs.model)
        : undefined;

    if (!selectedModel) {
      const available = await modelRuntime.getAvailable();
      selectedModel =
        available.find(
          (m) => m.provider === "deepseek" && m.id === "deepseek-v4-flash",
        ) ??
        available.find((m) => m.provider === "deepseek") ??
        available[0];
    }

    const { session, modelFallbackMessage } = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader: loader,
      modelRuntime,
      sessionManager,
      tools: prefs.tools,
      customTools: this.godotRpc ? createGodotTools(this.godotRpc) : [],
      ...(selectedModel ? { model: selectedModel } : {}),
      thinkingLevel: prefs.thinkingLevel,
    });

    const unsubscribe = this.bridgeEvents(session);
    const nextBundle: SessionBundle = {
      session,
      unsubscribe,
      cwd,
      sessionPath: this.sessionFileOf(session),
    };

    const previous = this.bundle;
    this.bundle = nextBundle;
    await this.disposeBundle(previous);

    const sessionPath = this.sessionFileOf(session);
    // Inactive fleet slots must not overwrite launcher prefs (model / last paths).
    if (this.isActiveSlot()) {
      if (session.model) {
        patchPrefs({
          provider: session.model.provider,
          model: session.model.id,
        });
      }
      patchPrefs({
        lastProjectPath: cwd,
        lastSessionPath: sessionPath,
      });
    }
    this.bundle.sessionPath = sessionPath;

    const history: HistoryItem[] = messagesToHistory(session.messages);

    const info: OpenProjectResult = {
      ok: true,
      cwd,
      sessionId: session.sessionId,
      model: modelFromSession(session),
      thinkingLevel: session.thinkingLevel as ThinkingLevel,
      history,
      ...(modelFallbackMessage ? { warning: modelFallbackMessage } : {}),
    };

    this.emit({
      type: "session_info",
      sessionId: session.sessionId,
      cwd,
      model: info.model,
      thinkingLevel: info.thinkingLevel,
      sessionPath,
    });
    this.emit({ type: "history_replace", items: history });
    if (modelFallbackMessage) {
      this.emit({
        type: "notice",
        text: modelFallbackMessage,
        level: "warn",
      });
    }
    this.setStatus("idle");
    return info;
  }

  async openProject(cwd: string, mode: "continue" | "new" = "continue"): Promise<OpenProjectResult> {
    return this.runReplaceExclusive(async () => {
      try {
        const root = getXAgentSessionsRoot();
        const sessionManager =
          mode === "new"
            ? SessionManager.create(cwd, root)
            : SessionManager.continueRecent(cwd, root);
        return await this.createSession(cwd, sessionManager);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.setStatus("error", message);
        return failOpen(message, this.bundle?.cwd ?? cwd);
      }
    });
  }

  async newSession(): Promise<OpenProjectResult> {
    const cwd = this.bundle?.cwd;
    if (!cwd) {
      return failOpen("尚未打开项目");
    }
    return this.openProject(cwd, "new");
  }

  async resumeSession(sessionPath: string): Promise<OpenProjectResult> {
    return this.runReplaceExclusive(async () => {
      try {
        if (!isXAgentSessionPath(sessionPath)) {
          return failOpen("只能恢复本客户端创建的会话（与 Pi CLI 会话已隔离）");
        }
        if (!existsSync(sessionPath)) {
          return failOpen("会话文件不存在");
        }
        const sessionManager = SessionManager.open(
          sessionPath,
          getXAgentSessionsRoot(),
        );
        const cwd = sessionManager.getCwd();
        if (!cwd) {
          return failOpen(
            "无法从会话文件解析项目路径，请先打开对应项目后再恢复",
          );
        }
        return await this.createSession(cwd, sessionManager);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.setStatus("error", message);
        return failOpen(message, this.bundle?.cwd ?? "");
      }
    });
  }

  async deleteSession(sessionPath: string): Promise<{ ok: boolean; error?: string }> {
    return this.runReplaceExclusive(async () => {
      if (!isXAgentSessionPath(sessionPath)) {
        return { ok: false, error: "只能删除本客户端会话" };
      }
      if (!existsSync(sessionPath)) {
        return { ok: false, error: "会话文件不存在" };
      }
      if (this.bundle?.sessionPath === sessionPath) {
        const cwd = this.bundle.cwd;
        await this.disposeBundle(this.bundle);
        this.bundle = null;
        patchPrefs({ lastSessionPath: null });
        if (cwd) {
          await this.createSession(
            cwd,
            SessionManager.create(cwd, getXAgentSessionsRoot()),
          );
        }
      } else {
        unlinkSync(sessionPath);
        const prefs = loadPrefs();
        if (prefs.lastSessionPath === sessionPath) {
          patchPrefs({ lastSessionPath: null });
        }
      }
      return { ok: true };
    });
  }

  async renameSession(
    sessionPath: string,
    name: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.runReplaceExclusive(async () => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: "名称不能为空" };
      if (!isXAgentSessionPath(sessionPath)) {
        return { ok: false, error: "只能重命名本客户端会话" };
      }
      try {
        if (this.bundle?.sessionPath === sessionPath) {
          this.bundle.session.setSessionName(trimmed);
          return { ok: true };
        }
        const sm = SessionManager.open(sessionPath, getXAgentSessionsRoot());
        sm.appendSessionInfo(trimmed);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  }

  /**
   * Kick off a prompt without waiting for the agent turn to finish.
   * Full completion is observed via lifecycle / status events.
   */
  beginPrompt(text: string): PromptResult {
    if (!this.bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return { ok: false, error: "消息不能为空" };
    }

    const { session } = this.bundle;
    const run = session.isStreaming
      ? session.prompt(trimmed, { streamingBehavior: "steer" })
      : session.prompt(trimmed);

    void run.catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus("error", message);
    });

    return { ok: true };
  }

  async prompt(text: string): Promise<PromptResult> {
    if (!this.bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return { ok: false, error: "消息不能为空" };
    }

    try {
      const { session } = this.bundle;
      if (session.isStreaming) {
        await session.prompt(trimmed, { streamingBehavior: "steer" });
      } else {
        await session.prompt(trimmed);
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus("error", message);
      return { ok: false, error: message };
    }
  }

  async abort(): Promise<{ ok: boolean }> {
    if (!this.bundle) return { ok: false };
    await this.bundle.session.abort();
    this.setStatus("idle");
    return { ok: true };
  }

  async setModel(
    provider: string,
    id: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.bundle) return { ok: false, error: "尚未打开项目" };
    try {
      const runtime = await this.ensureRuntime();
      const model = runtime.getModel(provider, id);
      if (!model) {
        return { ok: false, error: `未找到模型 ${provider}/${id}` };
      }
      await this.bundle.session.setModel(model);
      patchPrefs({ provider, model: id });
      this.emit({
        type: "session_info",
        sessionId: this.bundle.session.sessionId,
        cwd: this.bundle.cwd,
        model: modelFromSession(this.bundle.session),
        thinkingLevel: this.bundle.session.thinkingLevel as ThinkingLevel,
        sessionPath: this.bundle.sessionPath,
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<{ ok: boolean }> {
    if (!this.bundle) return { ok: false };
    this.bundle.session.setThinkingLevel(level);
    patchPrefs({ thinkingLevel: level });
    this.emit({
      type: "session_info",
      sessionId: this.bundle.session.sessionId,
      cwd: this.bundle.cwd,
      model: modelFromSession(this.bundle.session),
      thinkingLevel: level,
      sessionPath: this.bundle.sessionPath,
    });
    return { ok: true };
  }

  async applyTools(tools: string[]): Promise<{ ok: boolean; error?: string }> {
    patchPrefs({ tools });
    if (this.bundle) {
      try {
        this.bundle.session.setActiveToolsByName(tools);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return { ok: true };
  }

  async listModels(): Promise<ModelInfo[]> {
    const runtime = await this.ensureRuntime();
    const available = await runtime.getAvailable();
    return available.map((m) => ({
      provider: m.provider,
      id: m.id,
      name: (m as { name?: string }).name ?? m.id,
    }));
  }

  async listSessions(): Promise<SessionInfo[]> {
    try {
      const all = await SessionManager.listAll(getXAgentSessionsRoot());
      return all
        .slice()
        .sort((a, b) => {
          const at = new Date(a.modified ?? a.created ?? 0).getTime();
          const bt = new Date(b.modified ?? b.created ?? 0).getTime();
          return bt - at;
        })
        .slice(0, 50)
        .map((s) => ({
          id: s.id,
          name: displaySessionName(s.name, s.firstMessage),
          path: s.path,
          cwd: s.cwd ?? "",
          updatedAt: new Date(s.modified ?? s.created ?? Date.now()).toISOString(),
        }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({
        type: "notice",
        text: `列出会话失败: ${message}`,
        level: "warn",
      });
      return [];
    }
  }

  /**
   * Last user + assistant text excerpts for Fleet handoff when git diff fails.
   */
  getRecentTextExcerpt(maxChars = 4000): string {
    if (!this.bundle) return "";
    const messages = this.bundle.session.messages as readonly unknown[];
    let lastUser = "";
    let lastAssistant = "";
    for (const msg of messages) {
      const role = (msg as { role?: string }).role;
      if (role === "user") {
        const t = this.extractUserText(msg);
        if (t) lastUser = t;
      } else if (role === "assistant") {
        const t = this.extractUserText(msg);
        if (t) lastAssistant = t;
      }
    }
    const parts: string[] = [];
    if (lastUser) parts.push(`【用户】\n${lastUser}`);
    if (lastAssistant) parts.push(`【助理】\n${lastAssistant}`);
    const joined = parts.join("\n\n").trim();
    if (joined.length <= maxChars) return joined;
    return `${joined.slice(0, maxChars)}\n…(已截断)`;
  }

  getStatus(): HostStatus {
    return {
      status: this.status,
      cwd: this.bundle?.cwd ?? null,
      sessionId: this.bundle?.session.sessionId ?? null,
      sessionPath: this.bundle?.sessionPath ?? null,
      model: this.bundle ? modelFromSession(this.bundle.session) : null,
      thinkingLevel:
        (this.bundle?.session.thinkingLevel as ThinkingLevel) ?? "medium",
      error: this.lastError,
      hasSession: Boolean(this.bundle),
    };
  }

  async reloadResources(): Promise<{
    ok: boolean;
    reloaded: boolean;
    error?: string;
  }> {
    if (!this.bundle) {
      return { ok: true, reloaded: false };
    }
    try {
      await this.bundle.session.reload();
      this.emit({
        type: "notice",
        text: "已重载 prompts / skills / extensions",
        level: "info",
      });
      return { ok: true, reloaded: true };
    } catch (err) {
      return {
        ok: false,
        reloaded: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async dispose(): Promise<void> {
    return this.runReplaceExclusive(async () => {
      await this.disposeBundle(this.bundle);
      this.bundle = null;
    });
  }
}
