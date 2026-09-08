/**
 * shared/ipc 子模块 — 纯 DTO 类型 (issue #60 主题 D C-301).
 *
 * 之前 shared/ipc.ts 是 1300+ 行 god file, 同一文件里塞了
 *   - 协议 (IpcInvokeMap)  — 拆到 ./ipc-invoke-map.ts
 *   - 工具注册表           — 拆到 ../tools/* (C-306)
 *   - 偏好 (ClientPrefs + schema)  — 拆到 ./prefs.ts
 *   - 9 个 facade 类型      — 拆到 ./facades.ts
 *   - 纯 DTO (本文件)
 *
 * 拆分后 shared/ipc.ts 变薄壳 barrel re-export, 老的 100+ consumer
 * 不用改 import 路径. 本文件保持"无函数逻辑" — 只有 `type` / `interface`
 * 声明 + 几个与 DTO 强绑定的常量 (THINKING_LEVELS / DEFAULT_GOAL_MAX_*).
 */
import type { GodotRpcBridgeStatus, GodotRpcCall } from "../godot-rpc";
import type { SessionType } from "../session-type";

// -----------------------------------------------------------------------
// Agent status / thinking level — used by UiAgentEvent, ClientPrefs, etc.
// -----------------------------------------------------------------------

export type AgentStatus = "idle" | "streaming" | "retrying" | "error";

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/** Thinking levels in UI display order (low → high intensity). */
export const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// -----------------------------------------------------------------------
// Model / token / usage accounting
// -----------------------------------------------------------------------

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  /** Model context window in tokens (from Pi Model). */
  contextWindow?: number;
  /**
   * 模型接受的输入类型 (与 Pi SDK `Model.input` 对齐).
   *
   * - `["text"]`           : 纯文本模型
   * - `["text", "image"]`  : 多模态模型
   *
   * 部分 provider (比如 mistral-conversations) 会基于该字段在 user message
   * 含 image 时把整条 message 替换为 `(image omitted: model does not support
   * images)` 占位文本 — X-agent 端必须能读到该字段, 才能在 send 前
   * 给出"当前模型不收图"的明确反馈, 而不是让 AI 在回复里说"看不到图".
   *
   * 缺省 = 未知, 宁按纯文本判断 (保守: 不假设支持).
   */
  input?: ("text" | "image")[];
}

/** Per-turn / aggregate token counts (aligned with Pi Usage). */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/** Single-turn usage snapshot (assistant message). */
export interface TurnUsage {
  tokens: TokenUsage;
  cost: UsageCost;
}

export type ContextSegmentId =
  | "system"
  | "project"
  | "skills"
  | "tools"
  | "messages"
  /** Assistant toolCall arguments + toolResult bodies in the history. */
  | "toolHistory"
  /** Assistant thinking blocks (reasoning effort ≠ off). */
  | "thinking"
  /** API total minus text estimates: tool schemas + request framing. */
  | "overhead";

export interface ContextSegment {
  id: ContextSegmentId;
  label: string;
  tokens: number;
}

/** Estimated context fill + component breakdown. */
export interface ContextBreakdown {
  contextWindow: number;
  /** Estimated context tokens, or null if unknown. */
  tokens: number | null;
  /** Percent of context window, or null if tokens unknown. */
  percent: number | null;
  /** Heuristic segment split; tokens are estimates. */
  segments: ContextSegment[];
  estimated: true;
}

/** Live session usage pushed to the renderer. */
export interface SessionUsageSnapshot {
  tokens: TokenUsage;
  cost: number;
  context: ContextBreakdown | null;
  lastTurn?: TurnUsage;
  /** Message counts from getSessionStats. */
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
}

export interface CompactSessionResult {
  ok: boolean;
  error?: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
}

export interface UsageModelBucket {
  tokens: TokenUsage;
  cost: number;
  turns: number;
}

export interface UsageDayBucket {
  tokens: TokenUsage;
  cost: number;
  turns: number;
  byModel: Record<string, UsageModelBucket>;
}

export interface UsageSummary {
  days: Array<{ date: string } & UsageDayBucket>;
  byModel: Array<{ modelKey: string } & UsageModelBucket>;
  totals: UsageModelBucket;
}

// -----------------------------------------------------------------------
// Session / workspace lifecycle
// -----------------------------------------------------------------------

export interface SessionInfo {
  id: string;
  name: string;
  path: string;
  cwd: string;
  updatedAt: string;
  /**
   * Session type (see shared/session-type.ts). Legacy sessions without a
   * persisted sidecar are reported as "code".
   */
  sessionType: SessionType;
}

export interface BashCheckResult {
  ok: boolean;
  shellPath: string | null;
  message: string;
  /** Detected candidate that can be written to settings.json */
  suggestedShellPath?: string | null;
  /** Non-fatal warning (e.g. path outside common trusted directories). */
  warning?: string;
}

/**
 * Result of probeBashLiveness. Tri-state plus a "no tool" terminal state:
 * - live       round-trip works (commands + stdout both observable)
 * - half_dead  commands run (file side-effects) but stdout is not returned
 * - full_dead  bash did not produce the probe (timeout / non-zero / wrong)
 * - no_bash    no usable bash binary on this machine
 */
export type BashLivenessKind = "live" | "half_dead" | "full_dead" | "no_bash";

export interface BashLivenessResult {
  kind: BashLivenessKind;
  ok: boolean;
  shellPath: string | null;
  message: string;
  marker: string;
  probePath: string;
  ranSomething: boolean;
  timedOut: boolean;
  exitNonZero: boolean;
  stdoutPreview: string;
  stderrPreview: string;
}

export interface GitCheckResult {
  ok: boolean;
  gitPath: string | null;
  message: string;
}

export interface AuthStatus {
  ok: boolean;
  message: string;
  authPath: string;
}

export interface PiCliStatus {
  ok: boolean;
  piPath: string | null;
  message: string;
  /** True when npm is available for a global install */
  canInstall: boolean;
}

// -----------------------------------------------------------------------
// Goal mode / plan mode
// -----------------------------------------------------------------------

/** Session interaction mode — mutually exclusive. */
export type AgentSessionMode = "agent" | "ask" | "plan" | "goal";

export type GoalStatus =
  | "pursuing"
  | "paused"
  | "budget_limited"
  | "achieved"
  | "cleared";

/** Default auto-continue turn budget for Goal mode. */
export const DEFAULT_GOAL_MAX_TURNS = 20;

/** Default auto-continue token budget (input+output+cache) for Goal mode. */
export const DEFAULT_GOAL_MAX_TOKENS = 500_000;

/** Goal statuses that survive session restore / show the goal banner. */
export function isRestorableGoalStatus(
  status: GoalStatus | null | undefined,
): boolean {
  return (
    status === "pursuing" ||
    status === "paused" ||
    status === "budget_limited"
  );
}

export interface GoalInfo {
  condition: string;
  status: GoalStatus;
  /** Completed agent turns while pursuing (increments after each eval). */
  turns: number;
  /** Soft stop after this many turns (from prefs at setGoal time). */
  maxTurns: number;
  /** Tokens consumed while pursuing (sum of turn totals). */
  tokensUsed: number;
  /** Soft stop after this many tokens (from prefs at setGoal time). */
  maxTokens: number;
  lastReason?: string;
  startedAt: number;
}

export interface SessionModeInfo {
  mode: AgentSessionMode;
  planPath: string | null;
  tools: string[];
}

export type PlanFileLocation = "home" | "workspace";

export interface PlanContentResult {
  ok: boolean;
  error?: string;
  path?: string;
  markdown?: string;
  location?: PlanFileLocation;
}

export interface PlanMutateResult {
  ok: boolean;
  error?: string;
  path?: string;
  location?: PlanFileLocation;
  info?: SessionModeInfo;
}

export interface SessionModeResult {
  ok: boolean;
  error?: string;
  info?: SessionModeInfo;
  /** Entered Goal mode but no condition yet — UI should prompt for one. */
  needGoalCondition?: boolean;
}

export interface GoalResult {
  ok: boolean;
  error?: string;
  goal?: GoalInfo | null;
}

// -----------------------------------------------------------------------
// Secret / project / prompt / image / history
// -----------------------------------------------------------------------

/** Surface the `secret-codec` fallback status to the renderer for UI banner. */
export type SecretCodecReason =
  | "no-electron"
  | "keychain-unavailable"
  | "encrypt-failed";

export interface SecretCodecStatus {
  available: boolean;
  reason?: SecretCodecReason;
}

export interface OpenProjectResult {
  ok: boolean;
  cwd: string;
  sessionId: string;
  model: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
  /** Session type chosen at creation time; immutable for this session. */
  sessionType: SessionType;
  warning?: string;
  error?: string;
}

export interface PromptResult {
  ok: boolean;
  error?: string;
  /**
   * True when an extension slash command ran with no user bubble
   * (renderer should drop the optimistic pending message).
   */
  silent?: boolean;
}

/**
 * Image attachment for a prompt. Mirrors the shape of Pi SDK's
 * `ImageContent` (declared in `@earendil-works/pi-ai/dist/types.d.ts`)
 * but lives in `shared/` so the renderer never has to import the
 * Pi SDK type directly — keeps the renderer bundle free of
 * `@earendil-works/pi-ai`.
 *
 * The data is the base64-encoded image body (no `data:` URL prefix).
 * mimeType must be one of the supported image types; the renderer
 * enforces the whitelist at attachment time.
 */
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/**
 * Payload for the renderer → main `prompt` IPC. `text` is required
 * but may be empty when `images` carries the message (e.g. paste a
 * screenshot with no caption). main-side rejects the call when both
 * are empty.
 */
export interface PromptPayload {
  text: string;
  images?: ImageContent[];
}

/** Serializable chat history item shared by main → renderer. */
export type HistoryItem =
  | {
      kind: "user";
      id: string;
      text: string;
      entryId?: string;
      /**
       * 已附图片 (粘帖截图 / 拖放图片). 由 renderer 在 appendPendingUser 时
       * 写入;主进程 user_message 事件不带这个字段,apply-events 合并时保留
       * 已有 images 不动 (#42 修复 #2:让 user bubble 显示已附图).
       */
      images?: ImageContent[];
    }
  | {
      kind: "assistant";
      id: string;
      text: string;
      thinking: string;
      done: boolean;
      isError?: boolean;
      /** Pi session tree entry id (for regenerate → preceding user). */
      entryId?: string;
      /** Preceding user message entry id on the active branch. */
      userEntryId?: string;
      /** Unified diff of the turn (shadow pre→post), attached after turn_end. */
      diffText?: string;
      /** Rel-paths changed in this turn (shadow pre→post). */
      diffPaths?: string[];
      /** True when diffText was truncated to the payload cap. */
      diffTruncated?: boolean;
    }
  | {
      kind: "tool";
      id: string;
      toolName: string;
      args: unknown;
      result?: unknown;
      isError?: boolean;
      done: boolean;
    }
  | {
      kind: "system";
      id: string;
      text: string;
      level?: "info" | "warn" | "error";
      /** When set, a later notice with the same key replaces this bubble. */
      replaceKey?: NoticeReplaceKey;
    };

/**
 * Stable keys for "replaceable" notice bubbles (mode / model / tools / ...).
 * Same key replaces the previous bubble in the transcript; different keys stack.
 *
 * Single source — host bag 子编排器都 import 这一个,避免 drift.
 * 2026-08-31 收口 (issue #59 主题 A C-108). 之前 lifecycle.ts / controller.ts
 * / session-host.ts 3 处手搓 controller 旧硬写 "extension".
 */
export type NoticeReplaceKey =
  | "session_mode"
  | "model"
  | "tools"
  | "resources"
  | "plan"
  | "goal_eval"
  | "session"
  | "extension"
  | "auto-maintain";

export type FileRestoreSkipReason =
  | "bash_unknown"
  | "outside_cwd"
  | "no_baseline"
  | "godot"
  | "too_large"
  | "error";

export interface FileRestoreReport {
  restored: string[];
  deleted: string[];
  skipped: Array<{ path?: string; reason: FileRestoreSkipReason; detail?: string }>;
  warnings: string[];
}

export interface RetractOptions {
  /** Restore workspace files for the abandoned segment. Default true. */
  undoFiles?: boolean;
}

export interface RetractPreview {
  ok: boolean;
  error?: string;
  editorText?: string;
  /** Rel-paths that will be restored (shadow tree diff or write/edit baselines). */
  restorablePaths: string[];
  /** Rel-paths touched by write/edit but missing baseline (baseline fallback only). */
  unrestorablePaths: string[];
  hasBash: boolean;
  hasGodot: boolean;
  warnings: string[];
  /** How file restore will run. */
  restoreMode?: "shadow" | "baseline" | "none";
  /** True when Shadow Git checkpoints are active for this project. */
  shadowAvailable?: boolean;
  /** Unified diff (pre→HEAD+worktree) of restorable paths; shadow mode only. */
  diffText?: string;
  /** True when diffText was truncated to the payload cap. */
  diffTruncated?: boolean;
}

export interface RetractResult {
  ok: boolean;
  error?: string;
  editorText?: string;
  restoreReport?: FileRestoreReport;
}

// -----------------------------------------------------------------------
// UI agent event stream + host status
// -----------------------------------------------------------------------

/** Simplified events pushed to the renderer for UI rendering. */
export type UiAgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; willRetry?: boolean }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | {
      type: "turn_diff";
      /** Preceding user message entry id (matches assistant.userEntryId). */
      userEntryId: string;
      /** Rel-paths changed in this turn (shadow pre→post). */
      paths: string[];
      /** Unified diff text (already truncated). */
      diffText: string;
      /** True when diffText hit the payload cap. */
      truncated?: boolean;
    }
  | {
      type: "user_message";
      text: string;
      id?: string;
      entryId?: string;
    }
  | {
      type: "assistant_start";
      messageId: string;
      /** Preceding user entry id on the active branch (for regenerate). */
      userEntryId?: string;
    }
  | {
      type: "text_delta";
      messageId: string;
      delta: string;
    }
  | {
      type: "thinking_delta";
      messageId: string;
      delta: string;
    }
  | {
      type: "assistant_end";
      messageId: string;
      isError?: boolean;
      errorMessage?: string;
      usage?: TurnUsage;
    }
  | {
      type: "usage_update";
      usage: SessionUsageSnapshot;
    }
  | {
      type: "compaction_start";
      reason: "manual" | "threshold" | "overflow";
    }
  | {
      type: "compaction_end";
      reason: "manual" | "threshold" | "overflow";
      aborted: boolean;
      errorMessage?: string;
      tokensBefore?: number;
      estimatedTokensAfter?: number;
    }
  | {
      type: "tool_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_update";
      toolCallId: string;
      partialResult: unknown;
    }
  | {
      type: "tool_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | {
      type: "status";
      status: AgentStatus;
      error?: string;
    }
  | {
      type: "session_info";
      sessionId: string;
      cwd: string;
      model: ModelInfo | null;
      thinkingLevel: ThinkingLevel;
      /** Active session type (locked at creation). */
      sessionType?: SessionType;
      /**
       * Thinking levels the current model actually supports (Pi `getAvailableThinkingLevels`).
       * Renderer uses this to filter the SelectMenu so users don't pick a level that
       * Pi will silently clamp back to `off` (issue #30: thinking 切换被静默回退).
       */
      availableThinkingLevels: ThinkingLevel[];
      sessionPath?: string | null;
    }
  | {
      type: "history_replace";
      items: HistoryItem[];
    }
  | {
      type: "queue_update";
      steering: string[];
      followUp: string[];
    }
  | {
      type: "auto_retry";
      phase: "start" | "end";
      attempt: number;
      maxAttempts?: number;
      delayMs?: number;
      success?: boolean;
      message?: string;
    }
  | {
      type: "notice";
      text: string;
      level?: "info" | "warn" | "error";
      /**
       * Same-key notices replace the previous bubble in the transcript
       * (e.g. session mode switches) instead of stacking.
       */
      replaceKey?: NoticeReplaceKey;
    }
  | {
      type: "session_title";
      sessionId: string;
      name: string;
      sessionPath?: string | null;
    }
  | {
      type: "session_mode";
      mode: AgentSessionMode;
      planPath: string | null;
      tools: string[];
    }
  | {
      type: "goal_update";
      goal: GoalInfo | null;
    };

export interface HostStatus {
  status: AgentStatus;
  cwd: string | null;
  sessionId: string | null;
  sessionPath: string | null;
  model: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
  /** See {@link UiAgentEvent} session_info — for the renderer to filter the
   *  Composer thinking SelectMenu. Falls back to all THINKING_LEVELS when the
   *  bundle is missing (no project open). */
  availableThinkingLevels?: ThinkingLevel[];
  error?: string;
  hasSession: boolean;
}

// -----------------------------------------------------------------------
// Godot RPC DTOs (mirror main-process types; renderer-side types)
// -----------------------------------------------------------------------

/** Bridge status for renderer (same shape as main-process bridge status). */
export type GodotRpcStatusDto = GodotRpcBridgeStatus;

/** Godot RPC call from renderer (id assigned in main). */
export type GodotRpcCallDto = GodotRpcCall;

export interface GodotRpcRequestResult {
  ok: boolean;
  error?: string;
  result?: unknown;
  /** C1: 请求实际送达的客户端 id（preferred 未鉴权时的 fallback）。*/
  routedTo?: string;
}

export interface ToolDetailDto {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  done: boolean;
  truncated?: boolean;
}

// -----------------------------------------------------------------------
// Project filesystem DTOs
// -----------------------------------------------------------------------

export interface ProjectDirEntryDto {
  name: string;
  isDir: boolean;
}

export interface ListProjectDirResult {
  ok: boolean;
  entries?: ProjectDirEntryDto[];
  error?: string;
}

export interface ReadProjectFileResult {
  ok: boolean;
  path?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
}

export interface InstallGodotRpcAddonResult {
  ok: boolean;
  projectPath?: string;
  installed?: boolean;
  enabled?: boolean;
  error?: string;
  hint?: string;
}

// -----------------------------------------------------------------------
// Plugin DTOs
// -----------------------------------------------------------------------

export type PluginKind = "prompt" | "skill" | "extension" | "theme";
export type PluginScope = "global" | "project";

export interface PluginItem {
  kind: PluginKind;
  scope: PluginScope;
  id: string;
  name: string;
  path: string;
  description?: string;
  /** False for resources that live inside an installed Pi package. */
  editable: boolean;
  /** Present when the item comes from `pi install` package resources. */
  packageName?: string;
}

export interface PluginCreateInput {
  kind: PluginKind;
  scope: PluginScope;
  name: string;
  cwd?: string | null;
}

export interface PluginReadResult {
  ok: boolean;
  content?: string;
  warnings?: string[];
  error?: string;
}

export interface PluginWriteResult {
  ok: boolean;
  warnings?: string[];
  error?: string;
}

export interface PluginMutateResult {
  ok: boolean;
  item?: PluginItem;
  error?: string;
}

// -----------------------------------------------------------------------
// Skill + slash menu DTOs
// -----------------------------------------------------------------------

/** Skills available to the active session (after X-agent skillsOverride filters). */
export interface SessionSkillInfo {
  name: string;
  description: string;
}

/** Slash menu entry source (Pi runtime: skills / prompt templates / extension commands). */
export type SessionSlashSource = "skill" | "prompt" | "command";

/** Unified slash autocomplete item for the chat composer. */
export interface SessionSlashItem {
  /** Display + match name (skills omit the `skill:` insert prefix). */
  name: string;
  description: string;
  source: SessionSlashSource;
  /** Prompt templates may expose frontmatter `argument-hint`. */
  argumentHint?: string;
}

// -----------------------------------------------------------------------
// Provider profile / preset DTOs
// -----------------------------------------------------------------------

export type ProviderApiKind =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

/**
 * 模型接受的输入类型。与 Pi SDK `Model.input` 对齐。
 *
 * - "text"  : 文字输入
 * - "image" : 图片输入
 *
 * 缺省 = `undefined` (= 未表态) —— 不要在保存路径里强行塞 ["text"] 把它
 * 变成"已表态"；让 Pi SDK `applyModelsJson` 走 `override.input ?? model.input`
 * 自然 fall-through 到 builtin input。
 */
export type ModelInput = "text" | "image";

export interface ProviderModelEntry {
  id: string;
  name?: string;
  /** Context window in tokens; written to Pi models.json as contextWindow. */
  contextWindow?: number;
  /**
   * 模型接受的输入类型。透传到 Pi `models.json` 的 `input` 字段。
   *
   * 缺省 = 未表态（与 `ModelInfo.input` undefined 对齐）—— Pi SDK
   * `applyModelsJson` 用 `override.input ?? model.input` 兜底到 builtin；
   * X-agent UI 端 `modelSupportsImage` 在 undefined 时保守返回 false。
   *
   * 至少包含 "text" 的模型才会被允许发起普通对话；带 "image" 才允许在
   * user message 中附图（否则 `mistral-conversations` adapter 等会把整条
   * message 替换为 `(image omitted: model does not support images)`）。
   */
  input?: ModelInput[];
}

export interface ProviderProfile {
  id: string;
  name: string;
  providerId: string;
  api: ProviderApiKind;
  baseUrl: string;
  apiKey: string;
  models: ProviderModelEntry[];
  notes?: string;
  updatedAt: string;
  /** When true, profile is synced into Pi auth/models and appears in TopBar. */
  enabled: boolean;
  /**
   * 盘上密文（safeStorage 解不开时的保留备份）。
   * 解密失败时 apiKey 为空、此字段保留原 `enc:v1:` 串,保存时写回原密文，
   * 避免"换机器/密钥重置"后一次保存把密钥永久覆盖丢失.
   */
  encryptedKey?: string;
}

export interface ProviderProfileSummary {
  id: string;
  name: string;
  providerId: string;
  api: ProviderApiKind;
  baseUrl: string;
  modelCount: number;
  /** Synced into Pi / visible in TopBar model list. */
  enabled: boolean;
  updatedAt: string;
  /** Masked key hint for UI, e.g. sk-…xxx */
  apiKeyHint: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  providerId: string;
  api: ProviderApiKind;
  baseUrl: string;
  models: ProviderModelEntry[];
  notes?: string;
  /** UI grouping — aligned with cc-switch style categories */
  category?:
    | "official"
    | "cn"
    | "aggregator"
    | "compatible"
    | "custom";
  websiteUrl?: string;
}

export interface ProviderUpsertInput {
  id?: string;
  name: string;
  providerId: string;
  api: ProviderApiKind;
  baseUrl: string;
  apiKey: string;
  models: ProviderModelEntry[];
  notes?: string;
  /** Omit to keep existing value on edit; new profiles default to true. */
  enabled?: boolean;
}

export interface ProviderActivateResult {
  ok: boolean;
  error?: string;
  provider?: string;
  model?: string;
}

export interface FetchedProviderModel {
  id: string;
  ownedBy?: string;
  /** From API context_length / context_window / max_model_len when present. */
  contextWindow?: number;
  /**
   * 留位：未来第三方 `/v1/models` 端点若返回 input modality 后端会填。
   * 当前 OpenAI 兼容标准不返回（v1-models 只给 `id` / `owned_by` / 各类
   * 厂商自定义的 context 字段），所以 `fetchProviderModels` 不会填这个字段；
   * UI 端 fetch 合并路径走默认 `["text"]`。
   */
  input?: ModelInput[];
}

export interface FetchProviderModelsResult {
  ok: boolean;
  models?: FetchedProviderModel[];
  error?: string;
  tried?: string[];
}

export interface ProviderImportResult {
  ok: boolean;
  imported: number;
  skipped: number;
  /** Sources that contributed candidates, e.g. "pi", "cc-switch" */
  sources: string[];
  error?: string;
}

// -----------------------------------------------------------------------
// Package / update / startup-recovery DTOs
// -----------------------------------------------------------------------

export interface InstalledPackageInfo {
  name: string;
  source: string;
  installedAt: string;
  path?: string;
  /** Resource counts from package.json `pi` field (when path is local). */
  skillCount?: number;
  promptCount?: number;
  extensionCount?: number;
}

export interface PackageInstallResult {
  ok: boolean;
  error?: string;
  package?: InstalledPackageInfo;
  output?: string;
}

export interface AppUpdateStatus {
  supported: boolean;
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  version?: string;
  progress?: number;
  error?: string;
  message?: string;
  /** GitHub Releases page for manual download fallback. */
  releasesUrl?: string;
}

/** Shown once when x-agent.json was corrupt and backed up on startup. */
export interface PrefsRecoveryNotice {
  backedUp: boolean;
  backupPath?: string;
  error: string;
}

/** 1.3 启动期失误员件（recover / bridge / package install）。*/
export type StartupIssueStage =
  | "shadow_recover"
  | "godot_rpc"
  | "godot_pi_install";

export interface StartupIssue {
  stage: StartupIssueStage;
  message: string;
}

// -----------------------------------------------------------------------
// Client logo DTOs
// -----------------------------------------------------------------------

/**
 * Logo identifier for the user's client-branding choice.
 *
 * Encoded as a single string in `ClientPrefs.clientLogoId` so prefs round-trip
 * stays simple. Three shapes:
 *   - `"default"`        — original X-agent logo (build/icon.* + public/logo.png)
 *   - `"preset:NN-name"` — built-in preset under `apps/desktop/public/logos/`
 *   - `"custom:<uuid>"`  — user-uploaded image under
 *                          `~/.pi/agent/x-agent-logos/<uuid>.png`
 *
 * Anything else is treated as `"default"` by `parseLogoId` (defensive).
 */
export type ClientLogoId = string;

export interface LogoPreset {
  /** Always `"preset:NN-<slug>"`. */
  id: string;
  /** Human-readable Chinese label, e.g. "雁翎演练". */
  label: string;
  /** Renderer-relative path to the 1024×1024 webp (favicon / full-size). */
  url: string;
  /** Renderer-relative path to the 256×256 webp thumbnail (settings grid). */
  thumbnailUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface CustomLogo {
  /** Always `"custom:<uuid>"`. */
  id: string;
  /** Display label: `<originalName> · YYYY-MM-DD HH:mm`. */
  label: string;
  /** Renderer-relative URL served via the `x-agent-logos://` custom protocol. */
  url: string;
  fileName: string;
  sizeBytes: number;
  width: number;
  height: number;
  uploadedAt: number;
}

export interface LogoList {
  presets: LogoPreset[];
  customs: CustomLogo[];
  /** The currently effective `ClientPrefs.clientLogoId`. */
  active: string;
}

export interface LogoUploadError {
  ok: false;
  error: string;
  code: "INVALID_FILE" | "FILE_TOO_LARGE" | "DIM_OUT_OF_RANGE" | "WRITE_FAILED";
}

export interface LogoUploadSuccess {
  ok: true;
  logo: CustomLogo;
}

export type LogoUploadResult = LogoUploadSuccess | LogoUploadError;

export interface LogoClearResult {
  ok: boolean;
  error?: string;
  /** True when the deletion also reverted `clientLogoId` to `"default"`. */
  revertedActive?: boolean;
}

// -----------------------------------------------------------------------
// Misc
// -----------------------------------------------------------------------

export type OpenProjectMode = "continue" | "new";
