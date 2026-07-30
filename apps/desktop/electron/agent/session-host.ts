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
  ALL_TOGGLEABLE_TOOLS,
  ClientPrefs,
  CompactSessionResult,
  HistoryItem,
  HostStatus,
  ModelInfo,
  OpenProjectResult,
  PromptResult,
  RetractOptions,
  RetractPreview,
  RetractResult,
  SessionInfo,
  SessionSkillInfo,
  SessionUsageSnapshot,
  ThinkingLevel,
  TurnUsage,
  UiAgentEvent,
} from "../../shared/ipc";
import { IPC_EVENTS } from "../../shared/ipc-channels";
import { getAgentDirPath, loadPrefs, patchPrefs } from "./prefs";
import { repairDeepSeekModelsJson } from "./provider-store";
import { branchEntriesToHistory } from "./history";
import { extractMessageText } from "./transcript-mapper";
import { getXAgentSessionsRoot, isXAgentSessionPath } from "./session-paths";
import {
  displaySessionName,
  ensureSessionTitle,
} from "./session-title";
import type { GodotRpcBridge } from "./godot-rpc-bridge";
import { createGodotTools } from "./godot-tools";
import { createGodotDocsTools } from "./godot-docs-tools";
import { TurnFileTracker } from "./turn-file-tracker";
import { ShadowCheckpointTracker } from "./shadow-checkpoints";
import {
  normalizeProjectKey,
  pickFallbackSessionPath,
  sessionPathsForProject,
} from "../../shared/project-path";
import { applyXAgentSkillsFilter } from "./filter-session-skills";
import { listPlugins } from "./plugin-host";
import { reloadAuthStorageCache } from "./model-runtime-auth";
import {
  emptyUsageSnapshot,
  failOpen,
  modelFromSession,
  type ToolDetailRecord,
} from "./session-host-helpers";
import {
  bridgeSessionEvents,
  type SessionEventBridgeDeps,
} from "./session-event-bridge";
import {
  buildUsageSnapshot as buildUsageSnapshotFor,
  captureCompactionBaseline as captureCompactionBaselineFor,
  recordCompactionDelta as recordCompactionDeltaFor,
  type CompactionStatsBaseline,
} from "./session-usage";

export type { ToolDetailRecord } from "./session-host-helpers";

type SessionBundle = {
  session: AgentSession;
  unsubscribe: () => void;
  cwd: string;
  sessionPath: string | null;
};

export class SessionHost {
  private bundle: SessionBundle | null = null;
  private modelRuntime: ModelRuntime | null = null;
  private status: AgentStatus = "idle";
  /** Prevent overlapping model title requests for the same open session. */
  private autoTitleInFlight = false;
  private lastError: string | undefined;
  private getWindow: () => BrowserWindow | null;
  private godotRpc: GodotRpcBridge | null;
  /** Serializes session create/replace/dispose only — not prompt/abort. */
  private replaceChain: Promise<void> = Promise.resolve();
  private messageSeq = 0;
  private idCache = new WeakMap<object, string>();
  /** Untruncated (capped) tool payloads for right-panel detail view. */
  private toolDetails = new Map<string, ToolDetailRecord>();
  private fileTracker = new TurnFileTracker();
  private shadowCheckpoints = new ShadowCheckpointTracker();
  /** Last successful assistant turn usage (for snapshot lastTurn). */
  private lastTurnUsage: TurnUsage | undefined;
  /** Session stats snapshot at compaction_start for daily-store delta. */
  private compactionStatsBaseline: CompactionStatsBaseline | null = null;
  /** Skip per-message daily recording while compaction LLM usage is in flight. */
  private compactionRecording = false;

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

  getHistorySnapshot(): HistoryItem[] {
    return this.historyFromBundle();
  }

  private historyFromBundle(): HistoryItem[] {
    if (!this.bundle) return [];
    try {
      const branch = this.bundle.session.sessionManager.getBranch();
      return branchEntriesToHistory(branch);
    } catch {
      return [];
    }
  }

  private emitHistoryReplace(): void {
    this.emit({ type: "history_replace", items: this.historyFromBundle() });
  }

  private buildUsageSnapshot(): SessionUsageSnapshot | null {
    if (!this.bundle) return null;
    return buildUsageSnapshotFor(this.bundle.session, this.lastTurnUsage);
  }

  private emitUsageUpdate(): void {
    if (!this.bundle) return;
    const usage = this.buildUsageSnapshot() ?? emptyUsageSnapshot();
    this.emit({ type: "usage_update", usage });
  }

  private captureCompactionBaseline(): void {
    this.compactionStatsBaseline = this.bundle
      ? captureCompactionBaselineFor(this.bundle.session)
      : null;
  }

  private recordCompactionDelta(): void {
    const baseline = this.compactionStatsBaseline;
    this.compactionStatsBaseline = null;
    if (!baseline || !this.bundle) return;
    recordCompactionDeltaFor(this.bundle.session, baseline);
  }

  private pruneToolDetailsToBranch(): void {
    if (!this.bundle) {
      this.toolDetails.clear();
      return;
    }
    const keep = new Set<string>();
    try {
      for (const entry of this.bundle.session.sessionManager.getBranch()) {
        if (entry.type !== "message") continue;
        const msg = entry.message as {
          role?: string;
          content?: Array<{ type?: string; id?: string }>;
        };
        if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
        for (const part of msg.content) {
          if (part.type === "toolCall" && part.id) keep.add(part.id);
        }
      }
    } catch {
      return;
    }
    for (const id of this.toolDetails.keys()) {
      if (!keep.has(id)) this.toolDetails.delete(id);
    }
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
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_EVENTS.agentEvent, event);
    }
  }

  private setStatus(status: AgentStatus, error?: string): void {
    this.status = status;
    if (error !== undefined) {
      this.lastError = error;
    } else if (status === "idle" || status === "streaming" || status === "retrying") {
      this.lastError = undefined;
    }
    this.emit({
      type: "status",
      status,
      ...(this.lastError ? { error: this.lastError } : {}),
    });
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
    const deps: SessionEventBridgeDeps = {
      emit: (event) => this.emit(event),
      setStatus: (status, error) => this.setStatus(status, error),
      setLastErrorSilently: (error) => {
        this.lastError = error;
      },
      emitUsageUpdate: () => this.emitUsageUpdate(),
      emitHistoryReplace: () => this.emitHistoryReplace(),
      messageIdFrom: (message) => this.messageIdFrom(message),
      fileTracker: this.fileTracker,
      shadowCheckpoints: this.shadowCheckpoints,
      toolDetails: this.toolDetails,
      getSession: () => this.bundle?.session ?? null,
      setLastTurnUsage: (usage) => {
        this.lastTurnUsage = usage;
      },
      isCompactionRecording: () => this.compactionRecording,
      setCompactionRecording: (value) => {
        this.compactionRecording = value;
      },
      captureCompactionBaseline: () => this.captureCompactionBaseline(),
      recordCompactionDelta: () => this.recordCompactionDelta(),
      clearCompactionBaseline: () => {
        this.compactionStatsBaseline = null;
      },
      maybeAutoTitleSession: () => this.maybeAutoTitleSession(),
      currentUserEntryId: () => this.currentUserEntryId(),
    };
    return bridgeSessionEvents(session, deps);
  }

  private currentUserEntryId(): string | undefined {
    if (!this.bundle) return undefined;
    try {
      const leaf = this.bundle.session.sessionManager.getLeafEntry();
      if (
        leaf &&
        leaf.type === "message" &&
        (leaf as { message?: { role?: string } }).message?.role === "user"
      ) {
        return leaf.id;
      }
      const branch = this.bundle.session.sessionManager.getBranch();
      for (let i = branch.length - 1; i >= 0; i--) {
        const e = branch[i]!;
        if (
          e.type === "message" &&
          (e as { message?: { role?: string } }).message?.role === "user"
        ) {
          return e.id;
        }
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  private resolveUserEntryId(entryId: string): {
    ok: true;
    entryId: string;
    editorText: string;
  } | { ok: false; error: string } {
    if (!this.bundle) return { ok: false, error: "尚未打开项目" };
    const sm = this.bundle.session.sessionManager;
    const entry = sm.getEntry(entryId);
    if (!entry) return { ok: false, error: "找不到该消息" };
    if (entry.type !== "message") {
      return { ok: false, error: "只能从用户消息撤回" };
    }
    const msg = (entry as { message?: { role?: string; content?: unknown } }).message;
    if (!msg || msg.role !== "user") {
      return { ok: false, error: "只能从用户消息撤回" };
    }
    const editorText = extractMessageText(msg);
    if (!editorText) return { ok: false, error: "用户消息为空" };
    return { ok: true, entryId, editorText };
  }

  /**
   * After the first completed round, ensure the open session has a title once.
   */
  private async maybeAutoTitleSession(): Promise<void> {
    const bundle = this.bundle;
    if (!bundle || this.autoTitleInFlight) return;

    const messages = bundle.session.messages as readonly unknown[];
    let userText = "";
    let assistantText = "";
    for (const msg of messages) {
      const role = (msg as { role?: string }).role;
      if (!userText && role === "user") {
        userText = extractMessageText(msg);
      } else if (userText && !assistantText && role === "assistant") {
        assistantText = extractMessageText(msg);
        break;
      }
    }

    this.autoTitleInFlight = true;
    try {
      const decided = await ensureSessionTitle({
        currentName: bundle.session.sessionManager.getSessionName(),
        userText,
        assistantText,
        complete: async (prompt) => {
          const model = bundle.session.model;
          if (!model) return null;
          const runtime = await this.ensureRuntime();
          if (this.bundle !== bundle) return null;
          if (bundle.session.sessionManager.getSessionName()) return null;
          const result = await runtime.completeSimple(
            model,
            {
              messages: [
                {
                  role: "user",
                  content: prompt,
                  timestamp: Date.now(),
                },
              ],
              tools: [],
            },
            { maxTokens: 64, temperature: 0.2 },
          );
          if (this.bundle !== bundle) return null;
          if (bundle.session.sessionManager.getSessionName()) return null;
          if (result.stopReason === "error" || result.stopReason === "aborted") {
            return null;
          }
          return result.content
            .filter(
              (p): p is { type: "text"; text: string } =>
                !!p &&
                typeof p === "object" &&
                (p as { type?: string }).type === "text" &&
                typeof (p as { text?: unknown }).text === "string",
            )
            .map((p) => p.text)
            .join("")
            .trim();
        },
        isStale: () =>
          this.bundle !== bundle ||
          Boolean(bundle.session.sessionManager.getSessionName()),
      });

      if (!decided || decided.action !== "set") return;
      if (this.bundle !== bundle) return;
      if (bundle.session.sessionManager.getSessionName()) return;

      try {
        bundle.session.setSessionName(decided.title);
        this.emit({
          type: "session_title",
          sessionId: bundle.session.sessionId,
          name: decided.title,
          sessionPath: bundle.sessionPath,
        });
      } catch {
        // Non-fatal: listSessions still falls back to firstMessage.
      }
    } finally {
      this.autoTitleInFlight = false;
    }
  }

  private async ensureRuntime(): Promise<ModelRuntime> {
    if (!this.modelRuntime) {
      const dir = getAgentDirPath();
      // Fix legacy DeepSeek models.json entries missing reasoning (thinking→off).
      repairDeepSeekModelsJson();
      this.modelRuntime = await ModelRuntime.create({
        authPath: join(dir, "auth.json"),
        modelsPath: join(dir, "models.json"),
        // Avoid 15s remote-catalog wait on startup / provider reload.
        allowModelNetwork: false,
      });
    }
    return this.modelRuntime;
  }

  async reloadRuntime(): Promise<void> {
    if (this.modelRuntime) {
      try {
        reloadAuthStorageCache(this.modelRuntime);
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
        } else {
          // 重载成功但运行时没找到模型:明确告诉用户,避免"已启用"假象。
          const current = modelFromSession(this.bundle.session);
          this.emit({
            type: "notice",
            text: `已激活档案,但会话模型仍为 ${current?.id ?? "未设置"}（未找到 ${provider}/${modelId}）`,
            level: "warn",
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
      const error = err instanceof Error ? err.message : String(err);
      this.emit({
        type: "notice",
        text: `启用供应商失败：${error}`,
        level: "error",
      });
      return { ok: false, error };
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
    this.fileTracker.clear();
    this.shadowCheckpoints.clear();
    this.autoTitleInFlight = false;
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
      // Pi auto-loads ~/.agents/skills (Cursor/Claude skills). X-agent only
      // uses ~/.pi/agent/skills + project .pi/skills (+ installed packages).
      // Godot-tier skills (godot-*) are indexed only when cwd has project.godot.
      skillsOverride: (base) => ({
        skills: applyXAgentSkillsFilter(base.skills, cwd),
        diagnostics: base.diagnostics,
      }),
    });
    await loader.reload();

    let selectedModel =
      prefs.provider && prefs.model
        ? modelRuntime.getModel(prefs.provider, prefs.model)
        : undefined;

    if (!selectedModel) {
      // 偏好模型不可用(虚构 id / 旧 prefs 残留) → 退到 Pi 实际可用的真实模型并通知用户。
      // 我们**不**再硬编"deepseek-v4-flash":那是 DEFAULT_PREFS 之前的虚构 id,即使
      // 出现在 available[0] 也不一定是用户真正想用的;优先 Pi 内置 anthropic provider,
      // 其次首条 available[0]。
      const available = await modelRuntime.getAvailable();
      selectedModel =
        available.find((m) => m.provider === "anthropic") ?? available[0];
      if (selectedModel) {
        const usedKey =
          prefs.provider && prefs.model
            ? `${prefs.provider}/${prefs.model}`
            : "未配置";
        this.emit({
          type: "notice",
          text: `偏好模型 ${usedKey} 不可用,已切换到 ${selectedModel.provider}/${selectedModel.id}`,
          level: "warn",
        });
      }
    }

    // Resumed sessions already have thinking_level_change in the file. If we
    // pass thinkingLevel into createAgentSession, Pi sets agent state but skips
    // appending when an entry exists — leaving the file stale. Omit the option
    // so the agent restores the file level, then setThinkingLevel applies prefs
    // and persists the change.
    const hasThinkingEntry = sessionManager
      .getBranch()
      .some((entry) => entry.type === "thinking_level_change");

    const { session, modelFallbackMessage } = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader: loader,
      modelRuntime,
      sessionManager,
      // Pi uses `tools` as both registry allowlist and initial active set.
      // Register the full toggleable set so later prefs changes (e.g. enabling
      // Godot tools) can activate via setActiveToolsByName; unknown names are
      // otherwise silently ignored.
      tools: [...ALL_TOGGLEABLE_TOOLS],
      customTools: [
        ...(this.godotRpc ? createGodotTools(this.godotRpc) : []),
        ...createGodotDocsTools(),
      ],
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(!hasThinkingEntry ? { thinkingLevel: prefs.thinkingLevel } : {}),
    });
    // Apply「默认 Thinking」to the live session (clamps to model capabilities).
    session.setThinkingLevel(prefs.thinkingLevel);
    const effectiveThinking = session.thinkingLevel as ThinkingLevel;
    if (effectiveThinking !== prefs.thinkingLevel) {
      patchPrefs({ thinkingLevel: effectiveThinking });
    }
    session.setActiveToolsByName(prefs.tools);

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
    if (session.model) {
      // 若用户偏好仍是旧的虚构默认("deepseek/deepseek-v4-flash")，把真实生效模型
      // 写回 prefs 并显式通知；否则每次启动都以为已配置，实际却被静默回退。
      const previousWasLegacyDefault =
        prefs.provider === "deepseek" && prefs.model === "deepseek-v4-flash";
      patchPrefs({
        provider: session.model.provider,
        model: session.model.id,
      });
      if (previousWasLegacyDefault) {
        this.emit({
          type: "notice",
          text: `已重置默认模型：旧值 deepseek/deepseek-v4-flash 不可用，已切换到 ${session.model.provider}/${session.model.id}`,
          level: "warn",
        });
      }
    }
    patchPrefs({
      lastProjectPath: cwd,
      lastSessionPath: sessionPath,
    });
    this.bundle.sessionPath = sessionPath;

    this.fileTracker.setCwd(cwd);
    this.fileTracker.clear();
    this.fileTracker.loadFromSession(session.sessionManager);
    await this.shadowCheckpoints.setCwd(cwd);
    this.shadowCheckpoints.loadFromSession(session.sessionManager);

    const history: HistoryItem[] = branchEntriesToHistory(
      session.sessionManager.getBranch(),
    );

    const info: OpenProjectResult = {
      ok: true,
      cwd,
      sessionId: session.sessionId,
      model: modelFromSession(session),
      thinkingLevel: effectiveThinking,
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
    this.lastTurnUsage = undefined;
    this.setStatus("idle");
    this.emitUsageUpdate();
    return info;
  }

  private unhideProjectKey(cwd: string): void {
    const key = normalizeProjectKey(cwd);
    if (!key) return;
    const prefs = loadPrefs();
    const nextHidden = prefs.hiddenProjectKeys.filter(
      (k) => normalizeProjectKey(k) !== key,
    );
    if (nextHidden.length !== prefs.hiddenProjectKeys.length) {
      patchPrefs({ hiddenProjectKeys: nextHidden });
    }
  }

  async openProject(cwd: string, mode: "continue" | "new" = "continue"): Promise<OpenProjectResult> {
    return this.runReplaceExclusive(async () => {
      try {
        const root = getXAgentSessionsRoot();
        const sessionManager =
          mode === "new"
            ? SessionManager.create(cwd, root)
            : SessionManager.continueRecent(cwd, root);
        const result = await this.createSession(cwd, sessionManager);
        if (result.ok) this.unhideProjectKey(cwd);
        return result;
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
        const result = await this.createSession(cwd, sessionManager);
        if (result.ok) this.unhideProjectKey(cwd);
        return result;
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

      const wasActive = this.bundle?.sessionPath === sessionPath;
      const cwd = wasActive ? this.bundle!.cwd : null;

      if (wasActive) {
        await this.disposeBundle(this.bundle);
        this.bundle = null;
      }

      unlinkSync(sessionPath);

      const prefs = loadPrefs();
      if (prefs.lastSessionPath === sessionPath) {
        patchPrefs({ lastSessionPath: null });
      }

      if (!wasActive) {
        return { ok: true };
      }

      // Prefer another session in the same project; never silently create a new one.
      const remaining = await this.listSessions();
      const fallbackPath = pickFallbackSessionPath(
        remaining,
        cwd ?? "",
        sessionPath,
      );
      if (fallbackPath) {
        try {
          const sessionManager = SessionManager.open(
            fallbackPath,
            getXAgentSessionsRoot(),
          );
          const fallbackCwd = sessionManager.getCwd() || cwd;
          if (!fallbackCwd) {
            await this.emitClosedWorkspace();
            return { ok: true };
          }
          await this.createSession(fallbackCwd, sessionManager);
          return { ok: true };
        } catch {
          await this.emitClosedWorkspace(cwd);
          return { ok: true };
        }
      }

      await this.emitClosedWorkspace(cwd);
      return { ok: true };
    });
  }

  /** Delete all X-agent sessions belonging to a project cwd. */
  async deleteProjectSessions(
    projectCwd: string,
  ): Promise<{ ok: boolean; deleted?: number; error?: string }> {
    return this.runReplaceExclusive(async () => {
      const key = normalizeProjectKey(projectCwd);
      const listed = await this.listSessions();
      const paths = sessionPathsForProject(listed, projectCwd);
      if (paths.length === 0) {
        return { ok: true, deleted: 0 };
      }

      const activePath = this.bundle?.sessionPath ?? null;
      const activeCwd = this.bundle?.cwd ?? null;
      const activeInProject =
        Boolean(this.bundle) &&
        (activePath
          ? paths.includes(activePath)
          : normalizeProjectKey(activeCwd ?? "") === key);

      if (activeInProject) {
        await this.disposeBundle(this.bundle);
        this.bundle = null;
      }

      let deleted = 0;
      const prefs = loadPrefs();
      let clearLastSession = false;
      for (const sessionPath of paths) {
        if (!isXAgentSessionPath(sessionPath)) continue;
        if (!existsSync(sessionPath)) continue;
        unlinkSync(sessionPath);
        deleted += 1;
        if (prefs.lastSessionPath === sessionPath) {
          clearLastSession = true;
        }
      }

      if (clearLastSession) {
        patchPrefs({ lastSessionPath: null });
      }

      if (activeInProject) {
        await this.emitClosedWorkspace(activeCwd ?? projectCwd);
      }

      return { ok: true, deleted };
    });
  }

  /** Close current workspace without deleting session files (sidebar hide). */
  async closeWorkspace(): Promise<{ ok: boolean; error?: string }> {
    return this.runReplaceExclusive(async () => {
      const cwd = this.bundle?.cwd ?? null;
      await this.disposeBundle(this.bundle);
      this.bundle = null;
      this.lastTurnUsage = undefined;
      this.compactionStatsBaseline = null;
      this.compactionRecording = false;
      await this.emitClosedWorkspace(cwd);
      return { ok: true };
    });
  }

  private async emitClosedWorkspace(cwd?: string | null): Promise<void> {
    const prefs = loadPrefs();
    const patch: Partial<ClientPrefs> = { lastSessionPath: null };
    if (cwd && normalizeProjectKey(prefs.lastProjectPath ?? "") === normalizeProjectKey(cwd)) {
      patch.lastProjectPath = null;
    }
    patchPrefs(patch);
    this.emit({ type: "history_replace", items: [] });
    this.emit({
      type: "session_info",
      sessionId: "",
      cwd: "",
      model: null,
      thinkingLevel: loadPrefs().thinkingLevel,
      sessionPath: null,
    });
    this.setStatus("idle");
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
        await this.shadowCheckpoints.preparePromptCheckpoint();
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

  async previewRetract(entryId: string): Promise<RetractPreview> {
    const resolved = this.resolveUserEntryId(entryId);
    if (!resolved.ok) {
      return {
        ok: false,
        error: resolved.error,
        restorablePaths: [],
        unrestorablePaths: [],
        hasBash: false,
        hasGodot: false,
        warnings: [],
        restoreMode: "none",
        shadowAvailable: this.shadowCheckpoints.enabledShadow,
      };
    }
    const sm = this.bundle!.session.sessionManager;
    const scan = this.fileTracker.scanSegmentSince(sm, resolved.entryId);
    const shadowPreview = await this.shadowCheckpoints.previewRestore(
      sm,
      resolved.entryId,
      scan,
    );

    if (shadowPreview.mode === "shadow") {
      return {
        ok: true,
        editorText: resolved.editorText,
        restorablePaths: shadowPreview.restorablePaths,
        unrestorablePaths: [],
        hasBash: shadowPreview.hasBash,
        hasGodot: shadowPreview.hasGodot,
        warnings: shadowPreview.warnings,
        restoreMode: "shadow",
        shadowAvailable: true,
      };
    }

    const baseline = this.fileTracker.previewRestore(sm, resolved.entryId);
    const warnings = [
      ...shadowPreview.warnings,
      ...baseline.warnings.filter((w) => !shadowPreview.warnings.includes(w)),
    ];
    return {
      ok: true,
      editorText: resolved.editorText,
      restorablePaths: baseline.restorablePaths,
      unrestorablePaths: baseline.unrestorablePaths,
      hasBash: baseline.hasBash,
      hasGodot: baseline.hasGodot,
      warnings,
      restoreMode: "baseline",
      shadowAvailable: this.shadowCheckpoints.enabledShadow,
    };
  }

  /**
   * 撤回并切换到指定 user message。
   * 关键时序：
   *   1. abort 当前流（若有）。
   *   2. 只读 scan 即将废弃的 segment（不写盘）；navigate 取消时无需回滚。
   *   3. navigateTree；若 cancelled 则直接返回。
   *   4. navigate 成功后优先 Shadow checkout；否则按预扫路径 restorePaths。
   *   5. dropBaselines · persistDirty · 清空 activeUserEntryId · history replace。
   */
  async retractToUserMessage(
    entryId: string,
    options?: RetractOptions,
  ): Promise<RetractResult> {
    if (!this.bundle) return { ok: false, error: "尚未打开项目" };
    const resolved = this.resolveUserEntryId(entryId);
    if (!resolved.ok) return { ok: false, error: resolved.error };

    const undoFiles = options?.undoFiles !== false;
    const { session } = this.bundle;
    const sm = session.sessionManager;

    try {
      if (session.isStreaming) {
        await session.abort();
        this.setStatus("idle");
      }

      // 预扫必须在 navigate 之前：nav 后 abandoned write/edit 不在 active branch。
      const pendingScan = undoFiles
        ? this.fileTracker.scanSegmentSince(sm, resolved.entryId)
        : null;

      const nav = await session.navigateTree(resolved.entryId, {
        summarize: false,
      });
      if (nav.cancelled) {
        return { ok: false, error: "撤回已取消" };
      }

      let restoreReport: RetractResult["restoreReport"];
      if (undoFiles && pendingScan) {
        const shadow = await this.shadowCheckpoints.restoreToUserTurn(
          sm,
          resolved.entryId,
          pendingScan.userEntryIds,
        );
        if (shadow.used === "shadow" && shadow.report) {
          restoreReport = shadow.report;
          if (pendingScan.hasGodot) {
            restoreReport.skipped.push({ reason: "godot" });
            restoreReport.warnings.push(
              "该段包含会改编辑器状态的 Godot 工具，编辑器内存态无法还原。",
            );
          }
          if (pendingScan.hasBash) {
            restoreReport.warnings.push(
              "该段包含 bash：cwd 内文件已尽量由 Shadow 还原；cwd 外副作用无法还原。",
            );
          }
        } else {
          restoreReport = this.fileTracker.restorePaths(
            pendingScan.mutationPaths,
            pendingScan.userEntryIds,
          );
          if (shadow.report?.warnings.length) {
            restoreReport.warnings.push(
              "Shadow 检查点还原失败，已降级为 write/edit 基线。",
              ...shadow.report.warnings,
            );
          }
          if (pendingScan.hasBash) {
            restoreReport.skipped.push({ reason: "bash_unknown" });
            restoreReport.warnings.push(
              "该段包含 bash，命令副作用无法保证还原。",
            );
          }
          if (pendingScan.hasGodot) {
            restoreReport.skipped.push({ reason: "godot" });
            restoreReport.warnings.push(
              "该段包含会改编辑器状态的 Godot 工具，编辑器内存态无法还原。",
            );
          }
        }
        this.fileTracker.dropBaselinesForTurns(pendingScan.userEntryIds);
        this.fileTracker.persistDirty(sm);
      }

      // 撤回后旧 leaf 不再属于 active branch；下一次 user_message 事件再赋新 id。
      this.fileTracker.setActiveUserEntryId(null);
      this.pruneToolDetailsToBranch();
      this.emitHistoryReplace();
      this.emitUsageUpdate();
      this.setStatus("idle");

      return {
        ok: true,
        editorText: nav.editorText ?? resolved.editorText,
        restoreReport,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus("error", message);
      return { ok: false, error: message };
    }
  }

  async editAndResend(
    entryId: string,
    text: string,
    options?: RetractOptions,
  ): Promise<RetractResult> {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "消息不能为空" };

    const retract = await this.retractToUserMessage(entryId, options);
    if (!retract.ok) return retract;

    const prompted = await this.prompt(trimmed);
    if (!prompted.ok) {
      return {
        ok: false,
        error: prompted.error,
        editorText: retract.editorText,
        restoreReport: retract.restoreReport,
      };
    }
    return retract;
  }

  async regenerateFromUser(
    entryId: string,
    options?: RetractOptions,
  ): Promise<RetractResult> {
    const resolved = this.resolveUserEntryId(entryId);
    if (!resolved.ok) return { ok: false, error: resolved.error };

    const retract = await this.retractToUserMessage(entryId, options);
    if (!retract.ok) return retract;

    const text = (retract.editorText ?? resolved.editorText).trim();
    if (!text) return { ok: false, error: "用户消息为空" };

    const prompted = await this.prompt(text);
    if (!prompted.ok) {
      return {
        ok: false,
        error: prompted.error,
        editorText: text,
        restoreReport: retract.restoreReport,
      };
    }
    return { ...retract, editorText: text };
  }

  /**
   * 切换会话模型。校验通过并真正下发给 session 后再写 prefs，
   * 避免 prefs 已更新但 session 切换失败导致的"看起来生效实际无效"。
   */
  async setModel(
    provider: string,
    id: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.bundle) return { ok: false, error: "尚未打开项目" };
    try {
      const runtime = await this.ensureRuntime();
      const model = runtime.getModel(provider, id);
      if (!model) {
        const error = `未找到模型 ${provider}/${id}`;
        this.emit({ type: "notice", text: error, level: "error" });
        return { ok: false, error };
      }
      // 先下发到 session，再持久化 prefs；任一步失败都不污染 prefs。
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
      this.emitUsageUpdate();
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit({ type: "notice", text: `切换模型失败：${error}`, level: "error" });
      return { ok: false, error };
    }
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<{ ok: boolean }> {
    if (!this.bundle) return { ok: false };
    this.bundle.session.setThinkingLevel(level);
    // Persist the model-clamped effective level so prefs / TopBar / Settings stay
    // aligned (e.g. DeepSeek V4 maps medium→high; unsupported → nearest).
    const effective = this.bundle.session.thinkingLevel as ThinkingLevel;
    patchPrefs({ thinkingLevel: effective });
    this.emit({
      type: "session_info",
      sessionId: this.bundle.session.sessionId,
      cwd: this.bundle.cwd,
      model: modelFromSession(this.bundle.session),
      thinkingLevel: effective,
      sessionPath: this.bundle.sessionPath,
    });
    return { ok: true };
  }

  /**
   * 应用工具白名单。先尝试热切换；只有缺失的工具在可用清单内时才重建会话，
   * 且重建前后都会 emit notice，避免用户感到"会话无声闪烁"。
   */
  async applyTools(tools: string[]): Promise<{ ok: boolean; error?: string }> {
    patchPrefs({ tools });
    if (!this.bundle) return { ok: true };
    try {
      this.bundle.session.setActiveToolsByName(tools);
      this.emit({
        type: "notice",
        text: "已更新工具白名单（系统提示已重建）。本会话前缀缓存将从下一轮重新积累。",
        level: "warn",
      });
      const active = new Set(this.bundle.session.getActiveToolNames());
      const missing = tools.filter((name) => !active.has(name));
      if (missing.length === 0) return { ok: true };

      // 不在可切换清单内的名字重建也注册不上：告警即可，不要反复重建会话。
      const registrable = new Set<string>(
        ALL_TOGGLEABLE_TOOLS as readonly string[],
      );
      const rebuildable = missing.filter((name) => registrable.has(name));
      if (rebuildable.length === 0) {
        this.emit({
          type: "notice",
          text: `以下工具不在可用清单中，已忽略：${missing.join(", ")}`,
          level: "warn",
        });
        return { ok: true };
      }

      // Session was created before the full registry allowlist fix (or with a
      // narrower tools list). Recreate so newly enabled tools can register.
      const sessionPath = this.bundle.sessionPath;
      const cwd = this.bundle.cwd;
      this.emit({
        type: "notice",
        text: `正在重建会话以启用工具：${rebuildable.join(", ")}（历史保留）`,
        level: "info",
      });
      const result = sessionPath
        ? await this.resumeSession(sessionPath)
        : await this.openProject(cwd);
      if (!result.ok) {
        const error =
          result.error ??
          `部分工具未能启用：${missing.join(", ")}。请重新打开项目。`;
        this.emit({ type: "notice", text: error, level: "error" });
        return { ok: false, error };
      }
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit({
        type: "notice",
        text: `应用工具失败：${error}`,
        level: "error",
      });
      return { ok: false, error };
    }
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
        .slice(0, 100)
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

  getStatus(): HostStatus {
    return {
      status: this.status,
      cwd: this.bundle?.cwd ?? null,
      sessionId: this.bundle?.session.sessionId ?? null,
      sessionPath: this.bundle?.sessionPath ?? null,
      model: this.bundle ? modelFromSession(this.bundle.session) : null,
      thinkingLevel:
        (this.bundle?.session.thinkingLevel as ThinkingLevel) ??
        loadPrefs().thinkingLevel,
      error: this.lastError,
      hasSession: Boolean(this.bundle),
    };
  }

  /**
   * Skills available for the active session cwd after X-agent filters
   * (home ~/.agents excluded + godot-* only when project.godot exists).
   */
  listSessionSkills(): SessionSkillInfo[] {
    const cwd = this.bundle?.cwd;
    if (!cwd) return [];
    const skillItems = listPlugins(cwd).filter((p) => p.kind === "skill");
    const filtered = applyXAgentSkillsFilter(
      skillItems.map((p) => ({
        name: p.name,
        description: p.description ?? "",
        filePath: join(p.path, "SKILL.md"),
      })),
      cwd,
    );
    const byName = new Map<string, SessionSkillInfo>();
    for (const s of filtered) {
      if (!s.name || byName.has(s.name)) continue;
      byName.set(s.name, {
        name: s.name,
        description: s.description ?? "",
      });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getSessionUsage(): SessionUsageSnapshot | null {
    return this.buildUsageSnapshot();
  }

  async compactSession(
    customInstructions?: string,
  ): Promise<CompactSessionResult> {
    return this.runReplaceExclusive(async () => {
      if (!this.bundle) {
        return { ok: false, error: "尚未打开项目" };
      }
      if (this.status === "streaming" || this.status === "retrying") {
        return { ok: false, error: "请等待当前回合结束后再压缩" };
      }
      const session = this.bundle.session;
      if (session.isCompacting) {
        return { ok: false, error: "正在压缩中" };
      }
      const sessionId = session.sessionId;
      try {
        const result = await session.compact(
          customInstructions?.trim() || undefined,
        );
        if (this.bundle?.session.sessionId === sessionId) {
          this.emitUsageUpdate();
        }
        return {
          ok: true,
          tokensBefore: result.tokensBefore,
          estimatedTokensAfter: result.estimatedTokensAfter,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
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
      const prefs = loadPrefs();
      await this.bundle.session.reload();
      // Pi's reload may refresh the tool registry; re-apply user prefs so
      // active tools stay identical to createSession/openProject flow.
      this.bundle.session.setActiveToolsByName(prefs.tools);
      this.emit({
        type: "notice",
        text: "已重载 prompts / skills / extensions",
        level: "info",
      });
      this.emitUsageUpdate();
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
      this.lastTurnUsage = undefined;
      this.compactionStatsBaseline = null;
      this.compactionRecording = false;
    });
  }
}
