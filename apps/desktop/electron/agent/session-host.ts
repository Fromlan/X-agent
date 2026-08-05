import type { BrowserWindow } from "electron";
import { join } from "node:path";
import {
  DefaultResourceLoader,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { dbgLog, dbgTimer } from "../../shared/debug-log";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  ALL_TOGGLEABLE_TOOLS,
  SESSION_TOOL_REGISTRY,
  type AgentSessionMode,
  type AgentStatus,
  type ClientPrefs,
  type CompactSessionResult,
  type GoalInfo,
  type GoalResult,
  type HistoryItem,
  type HostStatus,
  type ModelInfo,
  type OpenProjectResult,
  type PlanContentResult,
  type PlanMutateResult,
  type PromptResult,
  type RetractOptions,
  type RetractPreview,
  type RetractResult,
  type SessionInfo,
  type SessionModeInfo,
  type SessionModeResult,
  type SessionSkillInfo,
  type SessionSlashItem,
  type SessionUsageSnapshot,
  type ThinkingLevel,
  type TurnUsage,
  type UiAgentEvent,
} from "../../shared/ipc";
import { IPC_EVENTS } from "../../shared/ipc-channels";
import { getAgentDirPath, getCachedPrefs, patchPrefs } from "./prefs";
import {
  dedupeModelInfosForUi,
  filterModelsByCatalogEnabled,
  repairDeepSeekModelsJson,
} from "./provider-store";
import {
  branchEntriesToHistory,
  extractMessageText,
} from "../../shared/transcript";
import { ensureSessionTitle } from "./session-title";
import type { GodotRpcBridge } from "./godot-rpc-bridge";
import { wrapPromptSlashAsBlock } from "./prompt-slash-wrap";
import { buildSessionSlashItems } from "./session-slash-items";
import {
  SessionModeController,
  type SessionModeHost,
  isReadonlySessionMode,
} from "./session-mode/index";
import {
  RetractOrchestrator,
  type RetractOrchestratorHost,
} from "./retract-orchestrator";
import { TurnFileTracker } from "./turn-file-tracker";
import { ShadowCheckpointTracker } from "./shadow-checkpoints";
import { applyXAgentSkillsFilter } from "./filter-session-skills";
import { listPlugins } from "./plugin-host";
import { reloadAuthStorageCache } from "./model-runtime-auth";
import {
  emptyUsageSnapshot,
  modelFromSession,
  type ToolDetailRecord,
} from "./session-host-helpers";
import {
  SessionLifecycle,
  type SessionBundle,
  type SessionLifecycleAccess,
} from "./session-lifecycle";
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
  /** Sampling counters for high-frequency delta events (debug log only). */
  private textDeltaCount = 0;
  private thinkingDeltaCount = 0;
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
  /** Plan/Goal session mode orchestration. */
  private sessionMode: SessionModeController;
  /** Workspace open/resume/dispose orchestration. */
  private lifecycle: SessionLifecycle;
  /** 撤回撤销 pipeline orchestration. */
  private retractOrchestrator: RetractOrchestrator;
  /** Live resource loader for mutating mode system-append without full recreate. */
  private resourceLoader: DefaultResourceLoader | null = null;
  /** Base APPEND_SYSTEM.md entries (without mode inject); refreshed on loader.reload. */
  private baseAppendPrompt: string[] = [];

  constructor(
    getWindow: () => BrowserWindow | null,
    godotRpc: GodotRpcBridge | null = null,
  ) {
    this.getWindow = getWindow;
    this.godotRpc = godotRpc;
    this.sessionMode = new SessionModeController(() => this.asModeHost());
    this.retractOrchestrator = new RetractOrchestrator(() =>
      this.asRetractHost(),
    );
    this.lifecycle = new SessionLifecycle(() => this.asLifecycleAccess());
  }

  private asLifecycleAccess(): SessionLifecycleAccess {
    return {
      getBundle: () => this.bundle,
      setBundle: (bundle) => {
        this.bundle = bundle;
      },
      getResourceLoader: () => this.resourceLoader,
      setResourceLoader: (loader) => {
        this.resourceLoader = loader;
      },
      getBaseAppendPrompt: () => this.baseAppendPrompt,
      setBaseAppendPrompt: (base) => {
        this.baseAppendPrompt = base;
      },
      setLastTurnUsage: (u) => {
        this.lastTurnUsage = u;
      },
      clearCompactionState: () => {
        this.compactionStatsBaseline = null;
        this.compactionRecording = false;
      },
      setAutoTitleInFlight: (v) => {
        this.autoTitleInFlight = v;
      },
      setLastHistoryFingerprint: (fp) => {
        this.lastHistoryFingerprint = fp;
      },
      toolDetails: this.toolDetails,
      fileTracker: this.fileTracker,
      shadowCheckpoints: this.shadowCheckpoints,
      sessionMode: this.sessionMode,
      godotRpc: this.godotRpc,
      runReplaceExclusive: (fn) => this.runReplaceExclusive(fn),
      ensureRuntime: () => this.ensureRuntime(),
      bridgeEvents: (session) => this.bridgeEvents(session),
      emit: (event) => this.emit(event),
      emitReplaceableNotice: (replaceKey, notice, level) =>
        this.emitReplaceableNotice(replaceKey, notice, level),
      setStatus: (status, error) => this.setStatus(status, error),
      emitUsageUpdate: () => this.emitUsageUpdate(),
      historyFingerprint: (items) => this.historyFingerprint(items),
    };
  }

  /** Host bag for SessionModeController: session + emit + prompt + runtime. */
  private asModeHost(): SessionModeHost {
    return {
      getBundle: () => this.getBundle(),
      getResourceLoader: () => this.getResourceLoader(),
      getBaseAppendPrompt: () => this.getBaseAppendPrompt(),
      setBaseAppendPrompt: (base) => this.setBaseAppendPrompt(base),
      emit: (event) => this.emit(event),
      emitReplaceableNotice: (replaceKey, text, level) =>
        this.emitReplaceableNotice(replaceKey, text, level),
      prompt: (text) => this.prompt(text),
      ensureRuntime: () => this.ensureRuntime(),
      getLastTurnTokenTotal: () => this.lastTurnUsage?.tokens.total ?? 0,
      getActiveUserEntryId: () => this.fileTracker.getActiveUserEntryId(),
    };
  }

  private asRetractHost(): RetractOrchestratorHost {
    return {
      getBundle: () => this.bundle,
      fileTracker: this.fileTracker,
      shadowCheckpoints: this.shadowCheckpoints,
      setStatus: (status, error) => this.setStatus(status, error),
      pruneToolDetailsToBranch: () => this.pruneToolDetailsToBranch(),
      emitHistoryReplace: () => this.emitHistoryReplace(),
      emitUsageUpdate: () => this.emitUsageUpdate(),
      prompt: (text) => this.prompt(text),
      onRetractSuccess: (abandonedUserEntryIds) =>
        this.sessionMode.rollbackGoalAfterRetract(abandonedUserEntryIds),
    };
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

  private lastHistoryFingerprint: string | null = null;

  private historyFingerprint(items: HistoryItem[]): string {
    return items
      .map((item) => {
        switch (item.kind) {
          case "user":
            return `u:${item.id}:${item.entryId ?? ""}:${item.text.length}`;
          case "assistant":
            return `a:${item.id}:${item.entryId ?? ""}:${item.userEntryId ?? ""}:${item.text.length}:${item.thinking.length}:${item.done ? 1 : 0}`;
          case "tool": {
            const resultLen =
              typeof item.result === "string"
                ? item.result.length
                : item.result == null
                  ? 0
                  : 1;
            return `t:${item.id}:${item.toolName}:${resultLen}:${item.done ? 1 : 0}`;
          }
          case "system":
            return `s:${item.id}:${item.text.length}`;
          default:
            return `?:${(item as { id?: string }).id ?? ""}`;
        }
      })
      .join("|");
  }

  private emitHistoryReplace(): void {
    const items = this.historyFromBundle();
    const fingerprint = this.historyFingerprint(items);
    if (fingerprint === this.lastHistoryFingerprint) return;
    this.lastHistoryFingerprint = fingerprint;
    this.emit({ type: "history_replace", items });
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
    // Sample noisy delta events so we can still tell "no stream at all" from
    // "stream is happening but the log was filtered" — every 100th delta
    // gets a line, others are skipped.
    if (event.type === "text_delta") {
      this.textDeltaCount += 1;
      if (this.textDeltaCount === 1 || this.textDeltaCount % 100 === 0) {
        dbgLog("emit", "-> text_delta", { n: this.textDeltaCount, len: event.delta.length });
      }
    } else if (event.type === "thinking_delta") {
      this.thinkingDeltaCount += 1;
      if (this.thinkingDeltaCount === 1 || this.thinkingDeltaCount % 100 === 0) {
        dbgLog("emit", "-> thinking_delta", { n: this.thinkingDeltaCount, len: event.delta.length });
      }
    } else {
      // Reset stream counters when a non-delta event arrives — different turns
      // shouldn't share the counter.
      if (event.type === "assistant_end" || event.type === "agent_end") {
        this.textDeltaCount = 0;
        this.thinkingDeltaCount = 0;
      }
      dbgLog("emit", "->", event.type);
    }
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_EVENTS.agentEvent, event);
    } else {
      dbgLog("emit", "drop (window gone)", event.type);
    }
  }

  /** SessionModeHost — bundle + loader access for Plan/Goal controller. */
  getBundle(): { session: AgentSession; cwd: string; sessionPath?: string | null } | null {
    return this.bundle
      ? {
          session: this.bundle.session,
          cwd: this.bundle.cwd,
          sessionPath: this.bundle.sessionPath,
        }
      : null;
  }

  getResourceLoader(): DefaultResourceLoader | null {
    return this.resourceLoader;
  }

  getBaseAppendPrompt(): string[] {
    return this.baseAppendPrompt;
  }

  setBaseAppendPrompt(base: string[]): void {
    this.baseAppendPrompt = base;
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
      toolDetails: this.toolDetails,
      getSession: () => this.bundle?.session ?? null,
      turn: {
        fileTracker: this.fileTracker,
        shadowCheckpoints: this.shadowCheckpoints,
        currentUserEntryId: () => this.currentUserEntryId(),
      },
      usage: {
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
      },
      maybeAutoTitleSession: () => this.maybeAutoTitleSession(),
      onAgentSettled: () => {
        void this.sessionMode.onAgentSettled();
      },
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

  async reloadRuntime(options?: { hard?: boolean }): Promise<void> {
    // Provider enable/disable must drop removed providers; soft reloadConfig can
    // leave builtins / stale composition in place — hard recreates ModelRuntime.
    if (options?.hard) {
      this.modelRuntime = null;
      await this.ensureRuntime();
      return;
    }
    if (this.modelRuntime) {
      try {
        reloadAuthStorageCache(this.modelRuntime);
        // SDK 0.83: reloadConfig 已移除，refresh() 为正式替代（重读 models.json + 重建快照）。
        await this.modelRuntime.refresh();
        return;
      } catch {
        // fall through to recreate
      }
    }
    this.modelRuntime = null;
    await this.ensureRuntime();
  }

  /**
   * Status-style notices that should not stack in the transcript.
   * Same replaceKey replaces the previous bubble (mode / model / tools / …).
   */
  private emitReplaceableNotice(
    replaceKey:
      | "session_mode"
      | "model"
      | "tools"
      | "resources"
      | "plan"
      | "goal_eval"
      | "session"
      | "extension",
    text: string,
    level: "info" | "warn" | "error" = "info",
  ): void {
    this.emit({ type: "notice", text, level, replaceKey });
  }

  getSessionMode(): SessionModeInfo {
    return this.sessionMode.getInfo();
  }

  getGoal(): GoalInfo | null {
    return this.sessionMode.getGoal();
  }

  async setSessionMode(mode: AgentSessionMode): Promise<SessionModeResult> {
    return this.sessionMode.setMode(mode);
  }

  async buildPlan(): Promise<PromptResult> {
    return this.sessionMode.buildPlan();
  }

  getPlanContent(): PlanContentResult {
    return this.sessionMode.getPlanContent();
  }

  savePlanContent(markdown: string): PlanMutateResult {
    return this.sessionMode.savePlanContent(markdown);
  }

  savePlanToWorkspace(): PlanMutateResult {
    return this.sessionMode.savePlanToWorkspace();
  }

  clearPlan(): PlanMutateResult {
    return this.sessionMode.clearPlan();
  }

  async setGoal(condition: string): Promise<GoalResult> {
    return this.sessionMode.setGoal(condition);
  }

  async pauseGoal(): Promise<GoalResult> {
    return this.sessionMode.pauseGoal();
  }

  async resumeGoal(): Promise<GoalResult> {
    return this.sessionMode.resumeGoal();
  }

  async clearGoal(): Promise<GoalResult> {
    return this.sessionMode.clearGoal();
  }

  async openProject(cwd: string, mode: "continue" | "new" = "continue"): Promise<OpenProjectResult> {
    return this.lifecycle.openProject(cwd, mode);
  }

  async newSession(): Promise<OpenProjectResult> {
    return this.lifecycle.newSession();
  }

  async resumeSession(sessionPath: string): Promise<OpenProjectResult> {
    return this.lifecycle.resumeSession(sessionPath);
  }

  async deleteSession(sessionPath: string): Promise<{ ok: boolean; error?: string }> {
    return this.lifecycle.deleteSession(sessionPath);
  }

  async deleteProjectSessions(
    projectCwd: string,
  ): Promise<{ ok: boolean; deleted?: number; error?: string }> {
    return this.lifecycle.deleteProjectSessions(projectCwd);
  }

  async closeWorkspace(): Promise<{ ok: boolean; error?: string }> {
    return this.lifecycle.closeWorkspace();
  }

  async renameSession(
    sessionPath: string,
    name: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.lifecycle.renameSession(sessionPath, name);
  }

  async listSessions(): Promise<SessionInfo[]> {
    return this.lifecycle.listSessions();
  }

  async dispose(): Promise<void> {
    return this.lifecycle.dispose();
  }

  async prompt(text: string): Promise<PromptResult> {
    const bundle = this.bundle;
    if (!bundle) {
      dbgLog("session", "prompt rejected: no bundle");
      return { ok: false, error: "尚未打开项目" };
    }
    const trimmed = text.trim();
    if (!trimmed) {
      dbgLog("session", "prompt rejected: empty text");
      return { ok: false, error: "消息不能为空" };
    }

    dbgLog("session", "prompt start", {
      len: trimmed.length,
      preview: trimmed.slice(0, 80),
      isStreaming: bundle.session.isStreaming,
    });
    const doneShadow = dbgTimer("session", "preparePromptCheckpoint");
    const donePi = dbgTimer("session", "session.prompt");
    const doneAll = dbgTimer("session", "total prompt");

    try {
      const { session } = bundle;
      const slashName = trimmed.startsWith("/")
        ? (trimmed.match(/^\/([^\s]+)/)?.[1] ?? "")
        : "";
      const isExtensionCommand =
        Boolean(slashName) &&
        !slashName.startsWith("skill:") &&
        Boolean(session.extensionRunner.getCommand(slashName));

      // Wrap prompt templates as `<prompt>` so the UI can chip them
      // (Pi already wraps `/skill:name` as `<skill>`).
      let sendText = trimmed;
      if (!isExtensionCommand) {
        const wrapped = wrapPromptSlashAsBlock(trimmed, [
          ...session.promptTemplates,
        ]);
        if (wrapped) sendText = wrapped;
      }

      if (session.isStreaming) {
        dbgLog("session", "prompt: steer into active stream");
        await session.prompt(sendText, { streamingBehavior: "steer" });
        donePi();
      } else {
        dbgLog("session", "prompt: prepare shadow checkpoint…");
        await this.shadowCheckpoints.preparePromptCheckpoint();
        doneShadow();
        if (this.bundle !== bundle) {
          dbgLog("session", "prompt aborted: bundle switched during shadow");
          return { ok: false, error: "会话已切换" };
        }
        await session.prompt(sendText);
        donePi();
      }
      if (this.bundle !== bundle) {
        dbgLog("session", "prompt aborted: bundle switched after pi");
        return { ok: false, error: "会话已切换" };
      }
      doneAll();
      return isExtensionCommand ? { ok: true, silent: true } : { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dbgLog("session", "prompt threw", message);
      if (this.bundle === bundle) {
        this.setStatus("error", message);
      }
      return { ok: false, error: message };
    }
  }

  async abort(): Promise<{ ok: boolean }> {
    const bundle = this.bundle;
    if (!bundle) {
      dbgLog("session", "abort: no bundle");
      return { ok: false };
    }
    dbgLog("session", "abort start", { isStreaming: bundle.session.isStreaming });
    const done = dbgTimer("session", "session.abort");
    try {
      await bundle.session.abort();
      done();
    } catch (err) {
      dbgLog("session", "abort threw", err instanceof Error ? err.message : String(err));
    }
    if (this.bundle !== bundle) {
      dbgLog("session", "abort: bundle switched");
      return { ok: true };
    }
    this.setStatus("idle");
    return { ok: true };
  }

  async previewRetract(entryId: string): Promise<RetractPreview> {
    return this.retractOrchestrator.preview(entryId);
  }

  async retractToUserMessage(
    entryId: string,
    options?: RetractOptions,
  ): Promise<RetractResult> {
    return this.retractOrchestrator.retract(entryId, options);
  }

  async editAndResend(
    entryId: string,
    text: string,
    options?: RetractOptions,
  ): Promise<RetractResult> {
    return this.retractOrchestrator.editAndResend(entryId, text, options);
  }

  async regenerateFromUser(
    entryId: string,
    options?: RetractOptions,
  ): Promise<RetractResult> {
    return this.retractOrchestrator.regenerate(entryId, options);
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
        this.emitReplaceableNotice("model", error, "error");
        return { ok: false, error };
      }
      // 先下发到 session，再持久化 prefs；任一步失败都不污染 prefs。
      await this.bundle.session.setModel(model);
      void patchPrefs({ provider, model: id });
      this.emit({
        type: "session_info",
        sessionId: this.bundle.session.sessionId,
        cwd: this.bundle.cwd,
        model: modelFromSession(this.bundle.session),
        thinkingLevel: this.bundle.session.thinkingLevel as ThinkingLevel,
        sessionPath: this.bundle.sessionPath,
      });
      this.emitUsageUpdate();
      this.emitReplaceableNotice(
        "model",
        `已切换模型：${provider}/${id}`,
      );
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emitReplaceableNotice(
        "model",
        `切换模型失败：${error}`,
        "error",
      );
      return { ok: false, error };
    }
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<{ ok: boolean }> {
    if (!this.bundle) return { ok: false };
    this.bundle.session.setThinkingLevel(level);
    // Persist the model-clamped effective level so prefs / TopBar / Settings stay
    // aligned (e.g. DeepSeek V4 maps medium→high; unsupported → nearest).
    const effective = this.bundle.session.thinkingLevel as ThinkingLevel;
    void patchPrefs({ thinkingLevel: effective });
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
    void patchPrefs({ tools });
    if (!this.bundle) return { ok: true };

    // Ask/Plan: update prefs + savedTools snapshot, keep ephemeral read-only tools.
    if (isReadonlySessionMode(this.sessionMode.getMode())) {
      return this.sessionMode.applyReadonlyModeTools(tools);
    }

    try {
      this.bundle.session.setActiveToolsByName(tools);
      this.emitReplaceableNotice(
        "tools",
        "已更新工具白名单（系统提示已重建）。本会话前缀缓存将从下一轮重新积累。",
        "warn",
      );
      const active = new Set(this.bundle.session.getActiveToolNames());
      const missing = tools.filter((name) => !active.has(name));
      if (missing.length === 0) return { ok: true };

      // 不在可切换清单内的名字重建也注册不上：告警即可，不要反复重建会话。
      const registrable = new Set<string>(
        ALL_TOGGLEABLE_TOOLS as readonly string[],
      );
      const rebuildable = missing.filter((name) => registrable.has(name));
      if (rebuildable.length === 0) {
        this.emitReplaceableNotice(
          "tools",
          `以下工具不在可用清单中，已忽略：${missing.join(", ")}`,
          "warn",
        );
        return { ok: true };
      }

      // Session was created before the full registry allowlist fix (or with a
      // narrower tools list). Recreate so newly enabled tools can register.
      const sessionPath = this.bundle.sessionPath;
      const cwd = this.bundle.cwd;
      this.emitReplaceableNotice(
        "tools",
        `正在重建会话以启用工具：${rebuildable.join(", ")}（历史保留）`,
      );
      const result = sessionPath
        ? await this.resumeSession(sessionPath)
        : await this.openProject(cwd);
      if (!result.ok) {
        const error =
          result.error ??
          `部分工具未能启用：${missing.join(", ")}。请重新打开项目。`;
        this.emitReplaceableNotice("tools", error, "error");
        return { ok: false, error };
      }
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emitReplaceableNotice(
        "tools",
        `应用工具失败：${error}`,
        "error",
      );
      return { ok: false, error };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const runtime = await this.ensureRuntime();
    const available = await runtime.getAvailable();
    const prefs = getCachedPrefs();
    const mapped = available.map((m) => ({
      provider: m.provider,
      id: m.id,
      name: (m as { name?: string }).name ?? m.id,
      baseUrl: (m as { baseUrl?: string }).baseUrl,
    }));
    // Catalog enabled flag is authoritative for TopBar — not only models.json.
    const visible = await filterModelsByCatalogEnabled(mapped);
    return dedupeModelInfosForUi(visible, prefs.provider);
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
        getCachedPrefs().thinkingLevel,
      error: this.lastError,
      hasSession: Boolean(this.bundle),
    };
  }

  /**
   * Skills available for the active session cwd after X-agent filters
   * (home ~/.agents excluded + godot-* only when project.godot exists +
   * prefs.disabledSkills).
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
      getCachedPrefs().disabledSkills,
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

  /**
   * Composer `/` menu: extension commands + prompt templates + filtered skills.
   * Prefer Pi runtime lists; fall back to plugin-host prompt scan when needed.
   */
  listSessionSlashItems(): SessionSlashItem[] {
    const cwd = this.bundle?.cwd;
    if (!cwd) return [];

    const skills = this.listSessionSkills();

    type PromptSeed = {
      name: string;
      description: string;
      argumentHint?: string;
    };
    let prompts: PromptSeed[] = (
      this.resourceLoader?.getPrompts().prompts ?? []
    ).map((p) => ({
      name: p.name,
      description: p.description ?? "",
      argumentHint: p.argumentHint,
    }));
    if (prompts.length === 0 && this.bundle?.session) {
      prompts = this.bundle.session.promptTemplates.map((p) => ({
        name: p.name,
        description: p.description ?? "",
        argumentHint: p.argumentHint,
      }));
    }
    if (prompts.length === 0) {
      prompts = listPlugins(cwd)
        .filter((p) => p.kind === "prompt")
        .map((p) => ({
          name: p.name,
          description: p.description ?? "",
        }));
    }

    const commands = (
      this.bundle?.session.extensionRunner.getRegisteredCommands() ?? []
    ).map((c) => ({
      name: (c.invocationName || c.name).trim(),
      description: c.description ?? "",
    }));

    return buildSessionSlashItems({ skills, prompts, commands });
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
      await this.bundle.session.reload();
      // Pi's reload may refresh the tool registry / loader append; re-apply mode
      // system append + active tools so Plan/Goal instructions stay attached.
      if (this.resourceLoader) {
        await this.resourceLoader.reload();
      }
      this.sessionMode.refreshAfterResourceReload();
      this.emitReplaceableNotice(
        "resources",
        "已重载 prompts / skills / extensions",
      );
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

}
