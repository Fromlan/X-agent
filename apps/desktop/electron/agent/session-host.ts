import type { BrowserWindow } from "electron";
import { join } from "node:path";
import {
  DefaultResourceLoader,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { dbgLog, dbgTimer, dbgWarn } from "../../shared/debug-log";
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
  type NoticeReplaceKey,
  type OpenProjectResult,
  type PlanContentResult,
  type PlanMutateResult,
  type PromptPayload,
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
import type { SessionType } from "../../shared/session-type";
import { getAgentDirPath, getCachedPrefs, patchPrefs } from "./prefs";
import {
  repairDeepSeekModelsJson,
  repairMiniMaxModelsJson,
} from "./provider-store";
import { maybeAutoTitleSession } from "./auto-title";
import { setModel as setModelImpl, setThinkingLevel as setThinkingLevelImpl } from "./session-config";
import { applyTools as applyToolsImpl } from "./apply-tools";
import {
  compactSession as compactSessionImpl,
  reloadResources as reloadResourcesImpl,
  autoMaintainIfNeeded as autoMaintainIfNeededImpl,
} from "./session-maintenance";
import { getStatus as getStatusImpl, listModels as listModelsImpl } from "./session-info";
import {
  buildUsageSnapshot as buildUsageSnapshotImpl,
  historyFromBundle as historyFromBundleImpl,
  historyFingerprint as historyFingerprintImpl,
  emitHistoryReplace as emitHistoryReplaceImpl,
  emitUsageUpdate as emitUsageUpdateImpl,
  captureCompactionBaseline as captureCompactionBaselineImpl,
  recordCompactionDelta as recordCompactionDeltaImpl,
  pruneToolDetailsToBranch as pruneToolDetailsToBranchImpl,
} from "./history-emit";
import {
  TRUNCATION_RECOVERY_MARKER,
  buildTruncationRecoveryHint,
  notifyTruncation as notifyTruncationImpl,
} from "./truncation-recovery";
import { emitEvent as emitEventImpl } from "./event-emit";
import type { GodotRpcBridge } from "./godot-rpc-bridge";
import { runSessionPrompt, type SessionPromptHost } from "./session-prompt";
import { runSessionAbort, type SessionAbortHost } from "./session-abort";
import { listSessionSkills, listSessionSlashItems } from "./session-skills-list";
import {
  SessionModeController,
  isReadonlySessionMode,
} from "./session-mode/index";
import {
  RetractOrchestrator,
} from "./retract-orchestrator";
import { TurnFileTracker } from "./turn-file-tracker";
import { ShadowCheckpointTracker } from "./shadow-checkpoints";
import { autoMaintain } from "./auto-maintain";
import { reloadAuthStorageCache } from "./model-runtime-auth";
import { type ToolDetailRecord } from "./session-host-helpers";
import {
  SessionLifecycle,
  type SessionBundle,
} from "./session-lifecycle";
import type {
  CwdLock,
  EventBus,
  ResourceState,
  SessionLifecycleHost,
  SessionModeHost,
  RetractOrchestratorHost,
} from "./host-interfaces";
import {
  bridgeSessionEvents,
  type SessionEventBridgeDeps,
} from "./session-event-bridge";
import { type CompactionStatsBaseline } from "./session-usage";

export type { ToolDetailRecord } from "./session-host-helpers";

// re-export truncation recovery constants (history entry for external callers).
// 主实现在 ./truncation-recovery.ts, 这里保留 re-export 避免外部 import 路径变更.
export {
  TRUNCATION_RECOVERY_MARKER,
  buildTruncationRecoveryHint,
} from "./truncation-recovery";


export class SessionHost {
  private bundle: SessionBundle | null = null;
  private modelRuntime: ModelRuntime | null = null;
  private status: AgentStatus = "idle";
  /** Prevent overlapping model title requests for the same open session. */
  private autoTitleInFlight = false;
  /**
   * Consecutive-truncation retry counter. Incremented in `notifyTruncation`
   * (event-bridge detects `stopReason: "length"` with no actionable content)
   * and reset to 0 in `prompt()` whenever the text is not a recovery prompt
   * (i.e. user-typed input). Capped at `MAX_TRUNCATION_RETRIES` — beyond that
   * the host sets an error status and stops auto-retrying, asking the user
   * to lower thinking level / switch model.
   */
  private consecutiveTruncationRetries = 0;
  private static readonly MAX_TRUNCATION_RETRIES = 2;
  /**
   * True while prompt() is inside the preparePromptCheckpoint → session.prompt
   * transition (isStreaming is still false there, so a concurrent retract
   * would corrupt turn state / resurrect stale pre SHAs). Retract rejects
   * while this flag is set.
   */
  promptPreparing = false;
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
    // issue #59 主题 A: 3 个子编排器拿到的 host 直接 spread 3 个窄 helper
    // (ResourceState / EventBus / CwdLock) — 没有 asXxxHost 适配器方法.
    // 子编排器类型在 host-interfaces.ts 用 Pick<,字段> 显式选择, 看不到
    // 整张 host, typecheck 拦截 drift.
    this.sessionMode = new SessionModeController(() => ({
      ...this.asResourceState(),
      ...this.asEventBus(),
      ...this.asCwdLock(),
    }));
    this.retractOrchestrator = new RetractOrchestrator(() => ({
      ...this.asResourceState(),
      ...this.asEventBus(),
      ...this.asCwdLock(),
    }));
    this.lifecycle = new SessionLifecycle(() => ({
      ...this.asResourceState(),
      ...this.asEventBus(),
      ...this.asCwdLock(),
    }));
  }

  // ============ 3 个窄 host-bag 暴露 (issue #59 主题 A) ============
  // 替代 asLifecycleAccess / asModeHost / asRetractHost 3 个大 host-bag.
  // 3 个子编排器 (Lifecycle / Mode / Retract) 的 host 各自用 Pick<,字段> 显式
  // 选自己需要的几个方法, SessionHost 在构造时 spread 这 3 个 helper 拼出.
  // 没有 asXxxHost 适配器方法 — C-102 收口.

  private asResourceState(): ResourceState {
    return {
      getBundle: () => this.bundle,
      getResourceLoader: () => this.getResourceLoader(),
      getBaseAppendPrompt: () => this.getBaseAppendPrompt(),
      fileTracker: this.fileTracker,
      shadowCheckpoints: this.shadowCheckpoints,
      sessionMode: this.sessionMode,
      godotRpc: this.godotRpc,
      getLastTurnTokenTotal: () => this.lastTurnUsage?.tokens.total ?? 0,
      getActiveUserEntryId: () => this.fileTracker.getActiveUserEntryId(),
    };
  }

  private asEventBus(): EventBus {
    return {
      emit: (event) => this.emit(event),
      emitReplaceableNotice: (replaceKey, text, level) =>
        this.emitReplaceableNotice(replaceKey, text, level),
      setStatus: (status, error) => this.setStatus(status, error),
      emitUsageUpdate: () => this.emitUsageUpdate(),
      emitHistoryReplace: () => this.emitHistoryReplace(),
    };
  }

  /**
   * CwdLock: cwd 变更时的所有可变状态 + 操作 (合并自原 CwdOps + RuntimeState).
   * 字段全部 readonly 函数 / 对象引用, 不暴露 raw setter, 防止子编排器绕过
   * host 之间的同步路径. 子编排器通过 Pick<CwdLock, 字段名> 选择自己需要的.
   */
  private asCwdLock(): CwdLock {
    return {
      // 原 CwdOps 部分
      pruneToolDetailsToBranch: () => this.pruneToolDetailsToBranch(),
      ensureRuntime: () => this.ensureRuntime(),
      bridgeEvents: (session) => this.bridgeEvents(session),
      prompt: (payload) =>
        this.prompt(typeof payload === "string" ? { text: payload } : payload),
      promptPreparing: this.promptPreparing,
      isPromptPreparing: () => this.promptPreparing,
      // 原 RuntimeState 部分
      runReplaceExclusive: (fn) => this.runReplaceExclusive(fn),
      historyFingerprint: (items) => historyFingerprintImpl(items),
      toolDetails: this.toolDetails,
      setBundle: (bundle) => {
        this.bundle = bundle;
      },
      setResourceLoader: (loader) => {
        this.resourceLoader = loader;
      },
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
      onRetractSuccess: (abandonedUserEntryIds) =>
        this.sessionMode.rollbackGoalAfterRetract(abandonedUserEntryIds),
    };
  }

  getToolDetail(toolCallId: string): ToolDetailRecord | null {
    return this.toolDetails.get(toolCallId) ?? null;
  }

  getHistorySnapshot(): HistoryItem[] {
    return historyFromBundleImpl(this.historyEmitDeps());
  }

  private lastHistoryFingerprint: string | null = null;

  private emitHistoryReplace(): void {
    emitHistoryReplaceImpl(this.historyEmitDeps());
  }

  private buildUsageSnapshot(): SessionUsageSnapshot | null {
    return buildUsageSnapshotImpl(this.historyEmitDeps());
  }

  private emitUsageUpdate(): void {
    emitUsageUpdateImpl(this.historyEmitDeps());
  }

  private captureCompactionBaseline(): void {
    captureCompactionBaselineImpl(this.historyEmitDeps());
  }

  private recordCompactionDelta(): void {
    recordCompactionDeltaImpl(this.historyEmitDeps());
  }

  private pruneToolDetailsToBranch(): void {
    pruneToolDetailsToBranchImpl(this.historyEmitDeps());
  }

  /** 内部 helper: 拼装 history/usage/compaction emit 需要的 deps. */
  private historyEmitDeps() {
    return {
      getBundle: () => this.bundle,
      getLastTurnUsage: () => this.lastTurnUsage,
      getLastHistoryFingerprint: () => this.lastHistoryFingerprint,
      setLastHistoryFingerprint: (fp: string | null) => {
        this.lastHistoryFingerprint = fp;
      },
      toolDetails: this.toolDetails,
      getCompactionStatsBaseline: () => this.compactionStatsBaseline,
      setCompactionStatsBaseline: (b: unknown) => {
        this.compactionStatsBaseline = b as CompactionStatsBaseline | null;
      },
      getCompactionRecording: () => this.compactionRecording,
      setCompactionRecording: (v: boolean) => {
        this.compactionRecording = v;
      },
      emit: (event: UiAgentEvent) => this.emit(event),
    };
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
    emitEventImpl(
      {
        getWindow: () => this.getWindow(),
        getTextDeltaCount: () => this.textDeltaCount,
        setTextDeltaCount: (n) => {
          this.textDeltaCount = n;
        },
        getThinkingDeltaCount: () => this.thinkingDeltaCount,
        setThinkingDeltaCount: (n) => {
          this.thinkingDeltaCount = n;
        },
      },
      event,
    );
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
    return bridgeSessionEvents(session, this.buildEventBridgeDeps());
  }

  /** 组装 SessionEventBridgeDeps (Pi 事件桥接所需的所有 host 闭包).
   *  拆出来让 bridgeEvents 自身变成 1 行 delegator, host 主类更聚焦. */
  private buildEventBridgeDeps(): SessionEventBridgeDeps {
    return {
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
      autoMaintainIfNeeded: () => this.autoMaintainIfNeeded(),
      onAgentSettled: () => {
        void this.sessionMode.onAgentSettled();
      },
      notifyTruncation: (detail) => {
        void this.notifyTruncation(detail);
      },
    };
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
   * Logic lives in `./auto-title.ts` (extracted in issue #59 主题 A to slim
   * the host facade); this method is just a bridge to the helper.
   */
  private async maybeAutoTitleSession(): Promise<void> {
    return maybeAutoTitleSession({
      getBundle: () => this.bundle,
      ensureRuntime: () => this.ensureRuntime(),
      emit: (event) => this.emit(event),
      isInFlight: () => this.autoTitleInFlight,
      setInFlight: (v) => {
        this.autoTitleInFlight = v;
      },
    });
  }

  private async ensureRuntime(): Promise<ModelRuntime> {
    if (!this.modelRuntime) {
      const dir = getAgentDirPath();
      // Fix legacy DeepSeek models.json entries missing reasoning (thinking→off).
      await repairDeepSeekModelsJson();
      // Fix legacy MiniMax models.json entries missing reasoning / forceAdaptiveThinking.
      await repairMiniMaxModelsJson();
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
    replaceKey: NoticeReplaceKey,
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

  async openProject(
    cwd: string,
    mode: "continue" | "new" = "continue",
    sessionType?: SessionType,
  ): Promise<OpenProjectResult> {
    return this.lifecycle.openProject(cwd, mode, sessionType);
  }

  async newSession(sessionType?: SessionType): Promise<OpenProjectResult> {
    return this.lifecycle.newSession(sessionType);
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

  /**
   * Called by the event-bridge when the assistant message was truncated by
   * `max_tokens` with no text / no tool call (thinking used all output budget).
   * 逻辑在 `./truncation-recovery.ts` (issue #59 主题 A 提取).
   */
  notifyTruncation(detail: { messageId: string; outputTokens: number }): Promise<void> {
    return notifyTruncationImpl(
      {
        getBundle: () => this.bundle,
        getRetries: () => this.consecutiveTruncationRetries,
        setRetries: (v) => {
          this.consecutiveTruncationRetries = v;
        },
        setStatus: (status, error) => this.setStatus(status, error),
        prompt: (payload) => this.prompt(payload),
      },
      detail,
    );
  }

  /**
   * session.prompt orchestration. Logic lives in `./session-prompt.ts`
   * (issue #3 主题 E 提取). This method is now a 1-line delegator that
   * injects the host's bundle / status / shadow-checkpoint / truncation
   * retry surface through `SessionPromptHost`.
   */
  async prompt(payload: PromptPayload): Promise<PromptResult> {
    return runSessionPrompt(this.promptHost(), payload);
  }

  /** Internal helper: build the SessionPromptHost closure for `prompt()`. */
  private promptHost(): SessionPromptHost {
    return {
      getBundle: () => this.bundle,
      setStatus: (status, error) => this.setStatus(status, error),
      isPreparing: () => this.promptPreparing,
      setPreparing: (v) => {
        this.promptPreparing = v;
      },
      prepareShadowCheckpoint: () =>
        this.shadowCheckpoints.preparePromptCheckpoint(),
      resetTruncationRetries: () => {
        this.consecutiveTruncationRetries = 0;
      },
    };
  }

  /**
   * session.abort orchestration. Logic lives in `./session-abort.ts`
   * (issue #3 主题 E 提取). This method is now a 1-line delegator that
   * injects the host's bundle / status / notice surface through
   * `SessionAbortHost`.
   */
  async abort(): Promise<{ ok: boolean; cancelled?: boolean }> {
    return runSessionAbort(this.abortHost());
  }

  /** Internal helper: build the SessionAbortHost closure for `abort()`. */
  private abortHost(): SessionAbortHost {
    return {
      getBundle: () => this.bundle,
      setStatus: (status, error) => this.setStatus(status, error),
      emitReplaceableNotice: (replaceKey, text, level) =>
        this.emitReplaceableNotice(replaceKey, text, level),
    };
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
   * 逻辑在 `./session-config.ts` (issue #59 主题 A 提取).
   */
  setModel(
    provider: string,
    id: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return setModelImpl(this.sessionConfigDeps(), provider, id);
  }

  setThinkingLevel(
    level: ThinkingLevel,
  ): Promise<{ ok: boolean; thinkingLevel?: ThinkingLevel }> {
    return setThinkingLevelImpl(this.sessionConfigDeps(), level);
  }

  /** 内部 helper: 拼装 setModel / setThinkingLevel 需要的 deps. */
  private sessionConfigDeps() {
    return {
      getBundle: () => this.bundle,
      ensureRuntime: () => this.ensureRuntime(),
      emit: (event: UiAgentEvent) => this.emit(event),
      emitReplaceableNotice: (
        replaceKey: "model",
        text: string,
        level?: "info" | "warn" | "error",
      ) => this.emitReplaceableNotice(replaceKey, text, level),
      emitUsageUpdate: () => this.emitUsageUpdate(),
    };
  }

  /**
   * 应用工具白名单。先尝试热切换；只有缺失的工具在可用清单内时才重建会话，
   * 且重建前后都会 emit notice，避免用户感到"会话无声闪烁"。
   * 逻辑在 `./apply-tools.ts` (issue #59 主题 A 提取).
   */
  applyTools(tools: string[]): Promise<{ ok: boolean; error?: string }> {
    const bundle = this.bundle;
    if (!bundle) {
      void patchPrefs({ tools });
      return Promise.resolve({ ok: true });
    }
    return applyToolsImpl(
      {
        getBundle: () => bundle,
        isReadonlyMode: () => isReadonlySessionMode(this.sessionMode.getMode()),
        applyReadonlyModeTools: (t) =>
          this.sessionMode.applyReadonlyModeTools(t),
        rebuildSession: () =>
          bundle.sessionPath
            ? this.resumeSession(bundle.sessionPath)
            : this.openProject(bundle.cwd),
        emitReplaceableNotice: (replaceKey, text, level) =>
          this.emitReplaceableNotice(replaceKey, text, level),
      },
      tools,
    );
  }

  async listModels(): Promise<ModelInfo[]> {
    return listModelsImpl(this.sessionInfoDeps());
  }

  /** 逻辑在 `./session-info.ts` (issue #59 主题 A 提取). */
  getStatus(): HostStatus {
    return getStatusImpl(this.sessionInfoDeps());
  }

  /** 内部 helper: 拼装 getStatus / listModels 需要的 deps. */
  private sessionInfoDeps() {
    return {
      getStatus: () => this.status,
      getBundle: () => this.bundle,
      getLastError: () => this.lastError,
      ensureRuntime: () => this.ensureRuntime(),
    };
  }

  /**
   * Skills available for the active session cwd after X-agent filters
   * (home ~/.agents excluded + godot-* only when project.godot exists +
   * prefs.disabledSkills). 逻辑在 `./session-skills-list.ts` (主题 A 提取).
   */
  listSessionSkills(): SessionSkillInfo[] {
    return listSessionSkills(this.bundle?.cwd ?? null);
  }

  /**
   * Composer `/` menu: extension commands + prompt templates + filtered skills.
   * 逻辑在 `./session-skills-list.ts` (主题 A 提取).
   */
  listSessionSlashItems(): SessionSlashItem[] {
    return listSessionSlashItems({
      cwd: this.bundle?.cwd ?? null,
      session: this.bundle?.session ?? null,
      resourceLoader: this.resourceLoader,
    });
  }

  getSessionUsage(): SessionUsageSnapshot | null {
    return this.buildUsageSnapshot();
  }

  async compactSession(
    customInstructions?: string,
  ): Promise<CompactSessionResult> {
    return compactSessionImpl(this.maintenanceDeps(), customInstructions);
  }

  async reloadResources(): Promise<{
    ok: boolean;
    reloaded: boolean;
    error?: string;
  }> {
    return reloadResourcesImpl(this.maintenanceDeps());
  }

  /**
   * Run the snip-first + auto-compact pass. Called from
   * `session-event-bridge` on `turn_end` and on every Nth `tool_execution_end`.
   * Skips silently if there is no active bundle or the session is mid-stream.
   * Never throws; failures are logged via `dbgWarn`.
   * 逻辑在 `./session-maintenance.ts` (issue #59 主题 A 提取).
   */
  autoMaintainIfNeeded(): Promise<void> {
    return autoMaintainIfNeededImpl(this.maintenanceDeps());
  }

  /** 内部 helper: 拼装 compactSession / reloadResources / autoMaintainIfNeeded
   *  需要的 deps. */
  private maintenanceDeps() {
    return {
      getBundle: () => this.bundle,
      getStatus: () => this.status,
      runReplaceExclusive: <T>(fn: () => Promise<T>) =>
        this.runReplaceExclusive(fn),
      getResourceLoader: () => this.resourceLoader,
      refreshAfterResourceReload: () =>
        this.sessionMode.refreshAfterResourceReload(),
      emitUsageUpdate: () => this.emitUsageUpdate(),
      emitReplaceableNotice: (
        replaceKey: NoticeReplaceKey,
        text: string,
        level?: "info" | "warn" | "error",
      ) => this.emitReplaceableNotice(replaceKey, text, level),
    };
  }
}
