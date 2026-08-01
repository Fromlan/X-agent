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
  type SessionUsageSnapshot,
  type ThinkingLevel,
  type TurnUsage,
  type UiAgentEvent,
} from "../../shared/ipc";
import { IPC_EVENTS } from "../../shared/ipc-channels";
import { getAgentDirPath, loadPrefs, patchPrefs } from "./prefs";
import { clearGoalJournal } from "./goal-journal";
import { dedupeModelInfosForUi, repairDeepSeekModelsJson } from "./provider-store";
import { branchEntriesToHistory } from "./history";
import { extractMessageText } from "./transcript-mapper";
import { getXAgentSessionsRoot, isXAgentSessionPath } from "./session-paths";
import {
  displaySessionName,
  ensureSessionTitle,
} from "./session-title";
import type { GodotRpcBridge } from "./godot-rpc-bridge";
import { createGodotTools } from "./godot-tools";
import {
  computeAskModeTools,
  computePlanModeTools,
  createWritePlanTools,
  isReadonlySessionMode,
} from "./plan-tools";
import { createPlanModeGuardExtension } from "./plan-mode-guard";
import {
  SessionModeController,
  type SessionModeHost,
} from "./session-mode";
import {
  RetractOrchestrator,
  type RetractOrchestratorHost,
} from "./retract-orchestrator";
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
  /** Plan/Goal session mode orchestration. */
  private sessionMode: SessionModeController;
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
  }

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
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_EVENTS.agentEvent, event);
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
          this.emitReplaceableNotice(
            "model",
            `已激活档案,但会话模型仍为 ${current?.id ?? "未设置"}（未找到 ${provider}/${modelId}）`,
            "warn",
          );
        }
      }
      this.emitReplaceableNotice(
        "model",
        `已启用供应商 ${provider} / ${modelId}`,
      );
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emitReplaceableNotice(
        "model",
        `启用供应商失败：${error}`,
        "error",
      );
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
    this.lastHistoryFingerprint = null;
    // Do NOT clear resourceLoader here — createSession assigns the next loader
    // before disposing the previous bundle; wiping it would break Plan/Goal
    // system-append refresh and setActiveToolsByName via sessionMode.refreshSystemPrompt.
    this.sessionMode.reset({ emit: false });
  }

  /** Clear loader/state when the host no longer has an active session. */
  private clearResourceLoader(): void {
    this.resourceLoader = null;
    this.baseAppendPrompt = [];
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
      | "session",
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

  private async createSession(
    cwd: string,
    sessionManager: SessionManager,
  ): Promise<OpenProjectResult> {
    const prefs = loadPrefs();
    const modelRuntime = await this.ensureRuntime();
    const agentDir = getAgentDir();
    // Mode resets with each new session bundle.
    this.sessionMode.reset({ emit: false });
    this.baseAppendPrompt = [];
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      // Pi auto-loads ~/.agents/skills (Cursor/Claude skills). X-agent only
      // uses ~/.pi/agent/skills + project .pi/skills (+ installed packages).
      // Godot-tier skills (godot-*) are indexed only when cwd has project.godot.
      // User-disabled skills (prefs.disabledSkills) are dropped from the index.
      skillsOverride: (base) => ({
        skills: applyXAgentSkillsFilter(
          base.skills,
          cwd,
          loadPrefs().disabledSkills,
        ),
        diagnostics: base.diagnostics,
      }),
      // Plan/Goal instructions live in system append (not per user message).
      // SessionHost mutates the returned array on mode change, then rebuilds
      // via setActiveToolsByName → getAppendSystemPrompt().
      appendSystemPromptOverride: (base) => {
        this.setBaseAppendPrompt([...base]);
        return this.sessionMode.composeModeAppend(base);
      },
      extensionFactories: [
        createPlanModeGuardExtension({
          getMode: () => this.sessionMode.getMode(),
          getAllowedTools: () => {
            const prefsTools = loadPrefs().tools;
            const mode = this.sessionMode.getMode();
            if (mode === "ask") return computeAskModeTools(prefsTools);
            if (mode === "plan") return computePlanModeTools(prefsTools);
            return prefsTools;
          },
          getCwd: () => this.bundle?.cwd ?? null,
        }),
      ],
    });
    await loader.reload();
    this.resourceLoader = loader;

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
        this.emitReplaceableNotice(
          "model",
          `偏好模型 ${usedKey} 不可用,已切换到 ${selectedModel.provider}/${selectedModel.id}`,
          "warn",
        );
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
      // Pi uses `tools` as both registry allowlist AND initial active set.
      // Register the full toggleable set + write_plan so later prefs / Plan mode
      // can activate via setActiveToolsByName; unknown names are silently ignored
      // and would otherwise drop custom tools from the registry entirely.
      tools: [...SESSION_TOOL_REGISTRY],
      customTools: [
        ...(this.godotRpc ? createGodotTools(this.godotRpc) : []),
        ...createWritePlanTools(
          (path) => {
            this.sessionMode.onPlanWritten(path);
          },
          () => this.sessionMode.getPlanPath(),
        ),
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
    // Initial active set = user prefs only (write_plan stays registered but inactive
    // until Plan mode). Must run after createAgentSession so registry is built.
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
    // Re-bind after disposeBundle — must stay set for Plan/Goal mode switches.
    this.resourceLoader = loader;
    // Fresh in-memory mode; restore pursuing/paused goal from journal if any.
    this.sessionMode.emitSessionMode();
    this.sessionMode.emitGoal();
    this.sessionMode.restoreGoalFromJournal();

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
        this.emitReplaceableNotice(
          "model",
          `已重置默认模型：旧值 deepseek/deepseek-v4-flash 不可用，已切换到 ${session.model.provider}/${session.model.id}`,
          "warn",
        );
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
    this.lastHistoryFingerprint = this.historyFingerprint(history);
    this.emit({ type: "history_replace", items: history });
    if (modelFallbackMessage) {
      this.emitReplaceableNotice("model", modelFallbackMessage, "warn");
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
        // Null the bundle before dispose so bridgeSessionEvents ignores abort
        // traffic from the doomed session (getSession() !== session).
        const doomed = this.bundle;
        this.bundle = null;
        await this.disposeBundle(doomed);
        this.clearResourceLoader();
      }

      unlinkSync(sessionPath);
      clearGoalJournal(sessionPath);

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
        const doomed = this.bundle;
        this.bundle = null;
        await this.disposeBundle(doomed);
        this.clearResourceLoader();
      }

      let deleted = 0;
      const prefs = loadPrefs();
      let clearLastSession = false;
      for (const sessionPath of paths) {
        if (!isXAgentSessionPath(sessionPath)) continue;
        if (!existsSync(sessionPath)) continue;
        unlinkSync(sessionPath);
        clearGoalJournal(sessionPath);
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
      const doomed = this.bundle;
      this.bundle = null;
      await this.disposeBundle(doomed);
      this.clearResourceLoader();
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
    this.lastHistoryFingerprint = this.historyFingerprint([]);
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
    const bundle = this.bundle;
    if (!bundle) {
      return { ok: false, error: "尚未打开项目" };
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return { ok: false, error: "消息不能为空" };
    }

    try {
      const { session } = bundle;
      if (session.isStreaming) {
        await session.prompt(trimmed, { streamingBehavior: "steer" });
      } else {
        await this.shadowCheckpoints.preparePromptCheckpoint();
        if (this.bundle !== bundle) {
          return { ok: false, error: "会话已切换" };
        }
        await session.prompt(trimmed);
      }
      if (this.bundle !== bundle) {
        return { ok: false, error: "会话已切换" };
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.bundle === bundle) {
        this.setStatus("error", message);
      }
      return { ok: false, error: message };
    }
  }

  async abort(): Promise<{ ok: boolean }> {
    const bundle = this.bundle;
    if (!bundle) return { ok: false };
    await bundle.session.abort();
    if (this.bundle !== bundle) return { ok: true };
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
    const prefs = loadPrefs();
    const mapped = available.map((m) => ({
      provider: m.provider,
      id: m.id,
      name: (m as { name?: string }).name ?? m.id,
    }));
    return dedupeModelInfosForUi(mapped, prefs.provider);
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
      this.emitReplaceableNotice(
        "session",
        `列出会话失败: ${message}`,
        "warn",
      );
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
      loadPrefs().disabledSkills,
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

  async dispose(): Promise<void> {
    return this.runReplaceExclusive(async () => {
      const doomed = this.bundle;
      this.bundle = null;
      await this.disposeBundle(doomed);
      this.clearResourceLoader();
      this.lastTurnUsage = undefined;
      this.compactionStatsBaseline = null;
      this.compactionRecording = false;
    });
  }
}
