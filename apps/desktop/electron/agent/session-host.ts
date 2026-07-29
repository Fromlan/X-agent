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
  SessionUsageSnapshot,
  ThinkingLevel,
  TurnUsage,
  UiAgentEvent,
} from "../../shared/ipc";
import { getAgentDirPath, loadPrefs, patchPrefs } from "./prefs";
import { branchEntriesToHistory } from "./history";
import { getXAgentSessionsRoot, isXAgentSessionPath } from "./session-paths";
import { deriveSessionTitle, displaySessionName } from "./session-title";
import type { GodotRpcBridge } from "./godot-rpc-bridge";
import { createGodotTools } from "./godot-tools";
import { createGodotDocsTools } from "./godot-docs-tools";
import { TurnFileTracker } from "./turn-file-tracker";
import {
  normalizeProjectKey,
  pickFallbackSessionPath,
} from "../../shared/project-path";
import {
  buildContextBreakdown,
  promptTokensFromTurnUsage,
} from "./context-breakdown";
import { modelUsageKey, recordTurnUsage } from "./usage-store";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { excludeUserAgentsHomeSkills } from "./exclude-agents-home-skills";

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
    contextWindow:
      typeof model.contextWindow === "number" && model.contextWindow > 0
        ? model.contextWindow
        : undefined,
  };
}

function turnUsageFromMessage(message: unknown): TurnUsage | null {
  if (!message || typeof message !== "object") return null;
  const msg = message as {
    usage?: Record<string, unknown>;
    stopReason?: string;
  };
  if (msg.stopReason === "aborted" || msg.stopReason === "error") {
    return null;
  }
  const usage = msg.usage;
  if (!usage || typeof usage !== "object") return null;
  const input = Number(usage.input) || 0;
  const output = Number(usage.output) || 0;
  const cacheRead = Number(usage.cacheRead) || 0;
  const cacheWrite = Number(usage.cacheWrite) || 0;
  const totalTokens =
    Number(usage.totalTokens) || input + output + cacheRead + cacheWrite;
  if (totalTokens <= 0 && input + output + cacheRead + cacheWrite <= 0) {
    return null;
  }
  const costRaw = usage.cost as Record<string, unknown> | undefined;
  const costInput = Number(costRaw?.input) || 0;
  const costOutput = Number(costRaw?.output) || 0;
  const costCacheRead = Number(costRaw?.cacheRead) || 0;
  const costCacheWrite = Number(costRaw?.cacheWrite) || 0;
  const costParts = costInput + costOutput + costCacheRead + costCacheWrite;
  const costTotal = Number(costRaw?.total) || costParts;
  return {
    tokens: {
      input,
      output,
      cacheRead,
      cacheWrite,
      total: totalTokens,
    },
    cost: {
      input: costInput,
      output: costOutput,
      cacheRead: costCacheRead,
      cacheWrite: costCacheWrite,
      total: costTotal,
    },
  };
}

function emptyUsageSnapshot(): SessionUsageSnapshot {
  return {
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
    cost: 0,
    context: null,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
  };
}

/** Sum Pi chars/4 estimates across current in-memory conversation messages. */
function estimateMessageTokens(session: AgentSession): number {
  try {
    const messages = session.messages ?? [];
    let total = 0;
    for (const message of messages) {
      try {
        total += estimateTokens(message);
      } catch {
        /* skip unestimable message shapes */
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Tokens for messages after the last assistant turn.
 * Needed when a toolResult lands before the next assistant usage arrives.
 */
function estimateTrailingAfterLastAssistant(session: AgentSession): number {
  try {
    const messages = session.messages ?? [];
    let lastAssistant = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const role = (messages[i] as { role?: string } | undefined)?.role;
      if (role === "assistant") {
        lastAssistant = i;
        break;
      }
    }
    if (lastAssistant < 0 || lastAssistant >= messages.length - 1) return 0;
    let total = 0;
    for (let i = lastAssistant + 1; i < messages.length; i++) {
      try {
        total += estimateTokens(messages[i]);
      } catch {
        /* skip unestimable message shapes */
      }
    }
    return total;
  } catch {
    return 0;
  }
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
  /** Serializes session create/replace/dispose only — not prompt/abort. */
  private replaceChain: Promise<void> = Promise.resolve();
  private messageSeq = 0;
  private idCache = new WeakMap<object, string>();
  /** Untruncated (capped) tool payloads for right-panel detail view. */
  private toolDetails = new Map<string, ToolDetailRecord>();
  private fileTracker = new TurnFileTracker();
  /** Last successful assistant turn usage (for snapshot lastTurn). */
  private lastTurnUsage: TurnUsage | undefined;
  /** Session stats snapshot at compaction_start for daily-store delta. */
  private compactionStatsBaseline: {
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
    cost: number;
    modelKey: string;
  } | null = null;
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
    const session = this.bundle.session;
    try {
      const stats = session.getSessionStats();
      const ctx = session.getContextUsage();
      const contextWindow =
        ctx?.contextWindow ??
        (typeof session.model?.contextWindow === "number"
          ? session.model.contextWindow
          : 0);
      const context =
        contextWindow > 0
          ? buildContextBreakdown({
              systemPrompt: session.systemPrompt ?? "",
              contextWindow,
              // Pi's getContextUsage().tokens is often usage.totalTokens
              // (includes output). Use prompt-only input+cacheRead, plus any
              // trailing tool/user messages after the last assistant usage.
              contextTokens: this.lastTurnUsage
                ? promptTokensFromTurnUsage(this.lastTurnUsage.tokens) +
                  estimateTrailingAfterLastAssistant(session)
                : null,
              messageTokens: estimateMessageTokens(session),
            })
          : null;
      return {
        tokens: {
          input: stats.tokens.input,
          output: stats.tokens.output,
          cacheRead: stats.tokens.cacheRead,
          cacheWrite: stats.tokens.cacheWrite,
          total: stats.tokens.total,
        },
        cost: stats.cost,
        context,
        ...(this.lastTurnUsage ? { lastTurn: this.lastTurnUsage } : {}),
        userMessages: stats.userMessages,
        assistantMessages: stats.assistantMessages,
        toolCalls: stats.toolCalls,
      };
    } catch {
      return null;
    }
  }

  private emitUsageUpdate(): void {
    if (!this.bundle) return;
    const usage = this.buildUsageSnapshot() ?? emptyUsageSnapshot();
    this.emit({ type: "usage_update", usage });
  }

  private captureCompactionBaseline(): void {
    if (!this.bundle) {
      this.compactionStatsBaseline = null;
      return;
    }
    try {
      const session = this.bundle.session;
      const stats = session.getSessionStats();
      const model = session.model;
      this.compactionStatsBaseline = {
        tokens: {
          input: stats.tokens.input,
          output: stats.tokens.output,
          cacheRead: stats.tokens.cacheRead,
          cacheWrite: stats.tokens.cacheWrite,
          total: stats.tokens.total,
        },
        cost: stats.cost,
        modelKey: model
          ? modelUsageKey(model.provider, model.id)
          : "unknown/unknown",
      };
    } catch {
      this.compactionStatsBaseline = null;
    }
  }

  private recordCompactionDelta(): void {
    const baseline = this.compactionStatsBaseline;
    this.compactionStatsBaseline = null;
    if (!baseline || !this.bundle) return;
    try {
      const stats = this.bundle.session.getSessionStats();
      const tokens = {
        input: Math.max(0, stats.tokens.input - baseline.tokens.input),
        output: Math.max(0, stats.tokens.output - baseline.tokens.output),
        cacheRead: Math.max(
          0,
          stats.tokens.cacheRead - baseline.tokens.cacheRead,
        ),
        cacheWrite: Math.max(
          0,
          stats.tokens.cacheWrite - baseline.tokens.cacheWrite,
        ),
        total: Math.max(0, stats.tokens.total - baseline.tokens.total),
      };
      const costTotal = Math.max(0, stats.cost - baseline.cost);
      if (tokens.total <= 0 && costTotal <= 0) return;
      recordTurnUsage(baseline.modelKey, {
        tokens,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: costTotal,
        },
      });
    } catch {
      /* ignore */
    }
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
      win.webContents.send("agent:event", event);
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
    return session.subscribe((event) => {
      switch (event.type) {
        case "agent_start":
          this.setStatus("streaming");
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
          this.emit({ type: "agent_end", willRetry });
          this.emitUsageUpdate();
          break;
        }
        case "turn_start":
          this.emit({ type: "turn_start" });
          break;
        case "turn_end":
          if (this.bundle) {
            this.fileTracker.persistDirty(this.bundle.session.sessionManager);
          }
          this.emit({ type: "turn_end" });
          this.emitHistoryReplace();
          this.emitUsageUpdate();
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
              const entryId = this.currentUserEntryId();
              if (entryId) {
                this.fileTracker.setActiveUserEntryId(entryId);
              }
              this.emit({
                type: "user_message",
                text,
                id: entryId ?? this.messageIdFrom(event.message),
                ...(entryId ? { entryId } : {}),
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
            usage?: unknown;
          };
          if (msg.role === "assistant") {
            const isError =
              msg.stopReason === "error" || Boolean(msg.errorMessage);
            const isAborted = msg.stopReason === "aborted";
            const turnUsage =
              !isError && !isAborted
                ? turnUsageFromMessage(event.message)
                : null;
            if (turnUsage) {
              this.lastTurnUsage = turnUsage;
              const model = this.bundle?.session.model;
              if (model && !this.compactionRecording) {
                try {
                  recordTurnUsage(
                    modelUsageKey(model.provider, model.id),
                    turnUsage,
                  );
                } catch {
                  /* ignore persist errors */
                }
              }
            }
            this.emit({
              type: "assistant_end",
              messageId: this.messageIdFrom(event.message),
              isError,
              errorMessage: msg.errorMessage,
              ...(turnUsage ? { usage: turnUsage } : {}),
            });
            if (isError && msg.errorMessage) {
              this.setStatus("error", msg.errorMessage);
            }
          }
          break;
        }
        case "tool_execution_start": {
          this.fileTracker.captureBeforeTool(event.toolName, event.args);
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
        case "compaction_start":
          this.compactionRecording = true;
          this.captureCompactionBaseline();
          this.emit({
            type: "compaction_start",
            reason: event.reason,
          });
          break;
        case "compaction_end": {
          const result = event.result as
            | { tokensBefore?: number; estimatedTokensAfter?: number }
            | undefined;
          if (!event.aborted) {
            this.recordCompactionDelta();
          } else {
            this.compactionStatsBaseline = null;
          }
          this.compactionRecording = false;
          this.emit({
            type: "compaction_end",
            reason: event.reason,
            aborted: event.aborted,
            errorMessage: event.errorMessage,
            ...(result?.tokensBefore != null
              ? { tokensBefore: result.tokensBefore }
              : {}),
            ...(result?.estimatedTokensAfter != null
              ? { estimatedTokensAfter: result.estimatedTokensAfter }
              : {}),
          });
          this.emitHistoryReplace();
          this.emitUsageUpdate();
          break;
        }
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
    const editorText = this.extractUserText(msg);
    if (!editorText) return { ok: false, error: "用户消息为空" };
    return { ok: true, entryId, editorText };
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
        // Avoid 15s remote-catalog wait on startup / provider reload.
        allowModelNetwork: false,
      });
    }
    return this.modelRuntime;
  }

  /**
   * Pi AuthStorage caches auth.json in memory at create time. reloadConfig()
   * only reloads models.json — so after we write auth.json from provider
   * activate, credentials stay stale and getAvailable() returns [].
   */
  private reloadAuthStorageCache(runtime: ModelRuntime): void {
    const store = (
      runtime as unknown as {
        credentials?: { store?: { reload?: () => void } };
      }
    ).credentials?.store;
    store?.reload?.();
  }

  async reloadRuntime(): Promise<void> {
    if (this.modelRuntime) {
      try {
        this.reloadAuthStorageCache(this.modelRuntime);
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
      skillsOverride: (base) => ({
        skills: excludeUserAgentsHomeSkills(base.skills),
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
      thinkingLevel: prefs.thinkingLevel,
    });
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

    const history: HistoryItem[] = branchEntriesToHistory(
      session.sessionManager.getBranch(),
    );

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
      thinkingLevel: "medium",
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
      };
    }
    const sm = this.bundle!.session.sessionManager;
    const preview = this.fileTracker.previewRestore(sm, resolved.entryId);
    return {
      ok: true,
      editorText: resolved.editorText,
      ...preview,
    };
  }

  /**
   * 撤回并切换到指定 user message。
   * 关键时序：
   *   1. abort 当前流（若有）。
   *   2. navigateTree 之前**不**扫 segment —— 取消时无法保证重放安全。
   *   3. navigate 成功后，重新从 sessionManager.getBranch() 读 segment
   *      （navigate 后 branch 已切到新 leaf，idx = 0）。
   *   4. 仅在 nav 成功后调用 restorePaths。
   *   5. 撤回后清空 activeUserEntryId，下一次 user_message 事件再赋新 id。
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

    try {
      if (session.isStreaming) {
        await session.abort();
        this.setStatus("idle");
      }

      const nav = await session.navigateTree(resolved.entryId, {
        summarize: false,
      });
      if (nav.cancelled) {
        return { ok: false, error: "撤回已取消" };
      }

      const sm = session.sessionManager;
      let restoreReport: RetractResult["restoreReport"];
      if (undoFiles) {
        // 取消语义：navigate 前**不**持有 pendingScan 状态；preview / restore 每次现取 branch。
        const pendingScan = this.fileTracker.scanSegmentSince(
          sm,
          resolved.entryId,
        );
        restoreReport = this.fileTracker.restorePaths(
          pendingScan.mutationPaths,
          pendingScan.userEntryIds,
        );
        if (pendingScan.hasBash) {
          restoreReport.skipped.push({ reason: "bash_unknown" });
          restoreReport.warnings.push(
            "该段包含 bash，命令副作用无法保证还原。",
          );
        }
        if (pendingScan.hasGodot) {
          restoreReport.skipped.push({ reason: "godot" });
          restoreReport.warnings.push(
            "该段包含 Godot 工具，编辑器状态无法还原。",
          );
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
        (this.bundle?.session.thinkingLevel as ThinkingLevel) ?? "medium",
      error: this.lastError,
      hasSession: Boolean(this.bundle),
    };
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
