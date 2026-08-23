/** Shared IPC types between main and renderer. */

import { Type } from "typebox";
import type {
  GraduationStatus,
  StageId,
  StageInfo,
  StageSwitchResult,
} from "./stage";
import type {
  GodotRpcBridgeStatus,
  GodotRpcCall,
} from "./godot-rpc";
import type { IpcChannelKey } from "./ipc-channels";
export type { IpcChannelKey } from "./ipc-channels";

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

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  /** Model context window in tokens (from Pi Model). */
  contextWindow?: number;
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

export interface SessionInfo {
  id: string;
  name: string;
  path: string;
  cwd: string;
  updatedAt: string;
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
 * - ull_dead  bash did not produce the probe (timeout / non-zero / wrong)
 * - 
o_bash    no usable bash binary on this machine
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

export const AVAILABLE_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

export type BuiltinToolName = (typeof AVAILABLE_TOOLS)[number];

/** Godot editor RPC tools (opt-in via settings; not in DEFAULT_PREFS). */
export const GODOT_TOOLS = [
  "godot_editor_info",
  "godot_open_scenes",
  "godot_edited_scene",
  "godot_open_scene",
  "godot_reload_scene",
  "godot_run_scene",
  "godot_run_main_scene",
  "godot_import_resources",
  "godot_play_errors",
  "godot_stop_scene",
  // 1.2 扩展：场景内省（只读）
  "godot_get_scene_tree",
  "godot_get_node_properties",
  // 1.2 扩展：调试器 / 资源治理 / 导出 / 配置读写 / lint
  "godot_get_debugger_state",
  "godot_set_breakpoint",
  "godot_find_unused_resources",
  "godot_export_project",
  "godot_get_project_setting",
  "godot_set_project_setting",
  "godot_lint_scripts",
  // 1.3 扩展：只读文件内省 / UID / 类名 / 脚本反射 / 导出预检
  "godot_list_project_files",
  "godot_resolve_uid",
  "godot_wait_for_import_done",
  "godot_list_global_classes",
  "godot_find_class_name_conflicts",
  "godot_inspect_script",
  "godot_list_export_presets",
  "godot_check_export_templates",
] as const;

export type GodotToolName = (typeof GODOT_TOOLS)[number];

export const ALL_TOGGLEABLE_TOOLS = [
  ...AVAILABLE_TOOLS,
  ...GODOT_TOOLS,
] as const;

export {
  WRITE_PLAN_TOOL,
  READONLY_CORE_TOOLS,
  PLAN_MODE_CORE_TOOLS,
  PLAN_MODE_OPTIONAL_READONLY_TOOLS,
  PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS,
} from "./mode-tools";
import { WRITE_PLAN_TOOL } from "./mode-tools";

/** Full tool registry names for createAgentSession (toggleable + write_plan). */
export const SESSION_TOOL_REGISTRY = [
  ...ALL_TOGGLEABLE_TOOLS,
  WRITE_PLAN_TOOL,
] as const;

/** Session interaction mode — mutually exclusive. */
export type AgentSessionMode = "agent" | "ask" | "plan" | "goal";

// Re-export the public surface of the stage workflow so consumers (preload /
// renderer / main IPC handlers) can keep importing from shared/ipc.
export type {
  ArtifactSummary,
  GraduationCheck,
  GraduationCheckResult,
  GraduationStatus,
  ProjectStage,
  RightPanelTab,
  StageDefinition,
  StageHistoryEntry,
  StageId,
  StageInfo,
  StageSwitchResult,
  StageToolPreset,
  StageSkillPreset,
} from "./stage";

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

/** GUI theme family (color + style tokens). Independent of Pi TUI Theme plugins. */
export const THEME_IDS = [
  "default",
  "nord",
  "tokyo",
  "paper",
  "contrast",
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export type ColorMode = "light" | "dark";

export const THEME_LABELS: Record<ThemeId, string> = {
  default: "默认",
  nord: "Nord",
  tokyo: "Tokyo Night",
  paper: "Warm Paper",
  contrast: "High Contrast",
};

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" &&
    (THEME_IDS as readonly string[]).includes(value)
  );
}

export function isColorMode(value: unknown): value is ColorMode {
  return value === "light" || value === "dark";
}

/** Resolve theme prefs from a raw JSON blob (supports legacy `theme` / `cindy`). */
export function normalizeThemePrefs(raw: {
  themeId?: unknown;
  colorMode?: unknown;
  /** @deprecated Prefer themeId + colorMode */
  theme?: unknown;
}): { themeId: ThemeId; colorMode: ColorMode } {
  let themeId: ThemeId = "default";
  if (isThemeId(raw.themeId)) {
    themeId = raw.themeId;
  } else if (raw.themeId === "cindy") {
    // Legacy id renamed to `default`
    themeId = "default";
  }
  if (isColorMode(raw.colorMode)) {
    return { themeId, colorMode: raw.colorMode };
  }
  if (isColorMode(raw.theme)) {
    return { themeId, colorMode: raw.theme };
  }
  return { themeId, colorMode: "dark" };
}

export interface ClientPrefs {
  themeId: ThemeId;
  colorMode: ColorMode;
  showThinking: boolean;
  lastProjectPath: string | null;
  lastSessionPath: string | null;
  provider: string | null;
  model: string | null;
  thinkingLevel: ThinkingLevel;
  tools: string[];
  /**
   * Skill ids excluded from the session `<available_skills>` index and slash menu.
   * Empty = all discovered skills enabled (after Godot / home filters).
   */
  disabledSkills: string[];
  /** Absolute path to Godot editor executable (Godot_*.exe / godot). */
  godotEditorPath: string | null;
  /**
   * godot-docs git branch to clone/search (e.g. stable, master, 3.6).
   * Cached under ~/.pi/agent/x-agent/godot-docs/<branch>/.
   */
  /** Whether the right tool panel is open. */
  rightPanelOpen: boolean;
  /** Left session sidebar width in px. */
  sidebarWidth: number;
  /** Right tool panel width in px. */
  rightPanelWidth: number;
  /**
   * Project keys (`normalizeProjectKey`) hidden from the sidebar.
   * Session files are kept; opening the project again removes the key.
   */
  hiddenProjectKeys: string[];
  /**
   * Project keys that opted out of the Godot ready-checklist steps (“不再提醒”).
   * Closing the strip only hides it for the current session.
   */
  dismissedReadyChecklistKeys: string[];
  /**
   * Project keys where the "enable Godot editor tools" nudge was dismissed.
   */
  dismissedGodotToolsNudgeKeys: string[];
  /**
   * Auto-compact when context occupancy percent reaches this threshold (1–100).
   * `0` disables automatic compression.
   */
  autoCompactPercent: number;
  /**
   * Goal mode auto-continue turn budget (1–200). Soft-stops with
   * `budget_limited` when reached; user can raise and resume.
   */
  goalMaxTurns: number;
  /**
   * Goal mode auto-continue token budget (10_000–10_000_000). Soft-stops with
   * `budget_limited` when reached; user can raise and resume.
   */
  goalMaxTokens: number;
}

export const DEFAULT_PREFS: ClientPrefs = {
  themeId: "default",
  colorMode: "dark",
  showThinking: true,
  lastProjectPath: null,
  lastSessionPath: null,
  // 默认供应商/模型留空：首启动会按"已配置的 Pi 认证"或用户在"设置 → 供应商"中的选择
  // 决定，避免给虚构的"deepseek-v4-flash"赋予虚假合法身份。已存在的 prefs 文件保留旧值，
  // 迁移由 SessionHost.createSession 的 fallback 链通知 + 自动重写。
  provider: null,
  model: null,
  thinkingLevel: "high",
  tools: [...AVAILABLE_TOOLS],
  disabledSkills: [],
  godotEditorPath: null,
  rightPanelOpen: false,
  sidebarWidth: 260,
  rightPanelWidth: 360,
  hiddenProjectKeys: [],
  dismissedReadyChecklistKeys: [],
  dismissedGodotToolsNudgeKeys: [],
  autoCompactPercent: 0,
  goalMaxTurns: DEFAULT_GOAL_MAX_TURNS,
  goalMaxTokens: DEFAULT_GOAL_MAX_TOKENS,
};

/**
 * Runtime validation schemas for IPC `setPrefs` payloads.
 * - ClientPrefsSchema: strict,所有字段非 optional(读取已 normalize 的完整 prefs)
 * - ClientPrefsPatchSchema: 接受部分字段 + additionalProperties:false,拒绝任何未声明键
 *
 * 由 `app-runtime.ts` 中 setPrefs handler 入口通过 `Value.Check` 校验 patch,
 * 拒绝被攻陷的 renderer 写入任意字段(如 godotEditorPath、lastProjectPath、shellPath)。
 */
export const ClientPrefsSchema = Type.Object({
  themeId: Type.Union(THEME_IDS.map((t) => Type.Literal(t)) as never),
  colorMode: Type.Union([Type.Literal("light"), Type.Literal("dark")]),
  showThinking: Type.Boolean(),
  lastProjectPath: Type.Union([Type.Null(), Type.String()]),
  lastSessionPath: Type.Union([Type.Null(), Type.String()]),
  provider: Type.Union([Type.Null(), Type.String()]),
  model: Type.Union([Type.Null(), Type.String()]),
  thinkingLevel: Type.Union(
    (
      [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ] as const
    ).map((l) => Type.Literal(l)) as never,
  ),
  tools: Type.Array(Type.String()),
  disabledSkills: Type.Array(Type.String()),
  godotEditorPath: Type.Union([Type.Null(), Type.String()]),
  rightPanelOpen: Type.Boolean(),
  sidebarWidth: Type.Number(),
  rightPanelWidth: Type.Number(),
  hiddenProjectKeys: Type.Array(Type.String()),
  dismissedReadyChecklistKeys: Type.Array(Type.String()),
  dismissedGodotToolsNudgeKeys: Type.Array(Type.String()),
  autoCompactPercent: Type.Number(),
  goalMaxTurns: Type.Number(),
  goalMaxTokens: Type.Number(),
});

export const ClientPrefsPatchSchema = Type.Partial(ClientPrefsSchema, {
  additionalProperties: false,
});

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

/** Serializable chat history item shared by main ↔ renderer. */
export type HistoryItem =
  | { kind: "user"; id: string; text: string; entryId?: string }
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
      replaceKey?: string;
    };

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
      replaceKey?: string;
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
  error?: string;
  hasSession: boolean;
}

/** Bridge status for renderer (same shape as main-process bridge status). */
export type GodotRpcStatusDto = GodotRpcBridgeStatus;

/** Godot RPC call from renderer (id assigned in main). */
export type GodotRpcCallDto = GodotRpcCall;

export interface GodotRpcRequestResult {
  ok: boolean;
  error?: string;
  result?: unknown;
  /** C1: 请求实际送达的客户端 id（preferred 未鉴权时的 fallback）。 */
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

export type ProviderApiKind =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export interface ProviderModelEntry {
  id: string;
  name?: string;
  /** Context window in tokens; written to Pi models.json as contextWindow. */
  contextWindow?: number;
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
   * 盘上密文（safeStorage 解不开时的保留副本）。
   * 解密失败时 apiKey 为空、此字段保留原 `enc:v1:` 串，保存时写回原密文，
   * 避免「换机器/密钥环重置」后任一次保存把密钥永久覆盖丢失。
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
  /** Masked key hint for UI, e.g. sk-…xxxx */
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

/** 1.3 启动期失败摘要（recover / bridge / package install）。 */
export type StartupIssueStage =
  | "shadow_recover"
  | "godot_rpc"
  | "godot_pi_install";

export interface StartupIssue {
  stage: StartupIssueStage;
  message: string;
}

export type OpenProjectMode = "continue" | "new";

/** Coarse workspace / session lifecycle facade (facade methods stay on window.xAgent). */
export type WorkspaceApi = {
  open: IpcInvokeMap["openProject"];
  close: IpcInvokeMap["closeWorkspace"];
  newSession: IpcInvokeMap["newSession"];
  resume: IpcInvokeMap["resumeSession"];
  listSessions: IpcInvokeMap["listSessions"];
  deleteSession: IpcInvokeMap["deleteSession"];
  deleteProjectSessions: IpcInvokeMap["deleteProjectSessions"];
  renameSession: IpcInvokeMap["renameSession"];
  getStatus: IpcInvokeMap["getStatus"];
};

/** Coarse turn / composer facade (facade methods stay on window.xAgent). */
export type TurnApi = {
  prompt: IpcInvokeMap["prompt"];
  abort: IpcInvokeMap["abort"];
  previewRetract: IpcInvokeMap["previewRetract"];
  retract: IpcInvokeMap["retractToUserMessage"];
  editAndResend: IpcInvokeMap["editAndResend"];
  regenerate: IpcInvokeMap["regenerateFromUser"];
};

/** Coarse plan / goal mode facade (facade methods stay on window.xAgent). */
export type PlanApi = {
  setMode: IpcInvokeMap["setSessionMode"];
  getMode: IpcInvokeMap["getSessionMode"];
  build: IpcInvokeMap["buildPlan"];
  getContent: IpcInvokeMap["getPlanContent"];
  saveContent: IpcInvokeMap["savePlanContent"];
  saveToWorkspace: IpcInvokeMap["savePlanToWorkspace"];
  clear: IpcInvokeMap["clearPlan"];
  setGoal: IpcInvokeMap["setGoal"];
  pauseGoal: IpcInvokeMap["pauseGoal"];
  resumeGoal: IpcInvokeMap["resumeGoal"];
  clearGoal: IpcInvokeMap["clearGoal"];
  getGoal: IpcInvokeMap["getGoal"];
};

/** Project-level game stage workflow facade. */
export type StageApi = {
  get: IpcInvokeMap["getStage"];
  set: IpcInvokeMap["setStage"];
  getGraduation: IpcInvokeMap["getGraduation"];
  toggleManualCheck: IpcInvokeMap["toggleManualCheck"];
  /** Subscribe to push updates (open project / stage switch / manual check toggle). */
  onChanged: (handler: (info: StageInfo | null) => void) => () => void;
};

/** Active session tuning / context facade. Prefer over flat in new code. */
export type SessionApi = {
  setModel: IpcInvokeMap["setModel"];
  setThinkingLevel: IpcInvokeMap["setThinkingLevel"];
  listModels: IpcInvokeMap["listModels"];
  getSessionUsage: IpcInvokeMap["getSessionUsage"];
  compactSession: IpcInvokeMap["compactSession"];
  getToolDetail: IpcInvokeMap["getToolDetail"];
  reloadResources: IpcInvokeMap["reloadResources"];
  listSessionSlashItems: IpcInvokeMap["listSessionSlashItems"];
};

/** Client prefs + runtime dependency checks. */
export type PrefsApi = {
  get: IpcInvokeMap["getPrefs"];
  set: IpcInvokeMap["setPrefs"];
  getRecoveryNotice: IpcInvokeMap["getPrefsRecoveryNotice"];
  getSecretCodecStatus: IpcInvokeMap["getSecretCodecStatus"];
  checkBash: IpcInvokeMap["checkBash"];
  checkBashLiveness: IpcInvokeMap["checkBashLiveness"];
  applyBashShellPath: IpcInvokeMap["applyBashShellPath"];
  pickBashShell: IpcInvokeMap["pickBashShell"];
  checkGit: IpcInvokeMap["checkGit"];
  checkAuth: IpcInvokeMap["checkAuth"];
  checkPiCli: IpcInvokeMap["checkPiCli"];
  installPiCli: IpcInvokeMap["installPiCli"];
};

/**
 * Authoritative invoke-channel signatures: every key is one `ipcRenderer.invoke`
 * channel (key name == channel name, enforced at compile time against
 * IPC_CHANNELS). Preload forwarding and main-process handlers are both typed
 * against this map, so a channel signature lives in exactly one place.
 */
export type IpcInvokeMap = {
  openProject: (path?: string, mode?: OpenProjectMode) => Promise<OpenProjectResult>;
  prompt: (text: string) => Promise<PromptResult>;
  abort: () => Promise<{ ok: boolean }>;
  previewRetract: (entryId: string) => Promise<RetractPreview>;
  retractToUserMessage: (entryId: string, options?: RetractOptions) => Promise<RetractResult>;
  editAndResend: (entryId: string, text: string, options?: RetractOptions) => Promise<RetractResult>;
  regenerateFromUser: (entryId: string, options?: RetractOptions) => Promise<RetractResult>;
  newSession: () => Promise<OpenProjectResult>;
  setModel: (provider: string, id: string) => Promise<{ ok: boolean; error?: string }>;
  setThinkingLevel: (
    level: ThinkingLevel,
  ) => Promise<{ ok: boolean; thinkingLevel?: ThinkingLevel }>;
  setSessionMode: (mode: AgentSessionMode) => Promise<SessionModeResult>;
  getSessionMode: () => Promise<SessionModeInfo>;
  buildPlan: () => Promise<PromptResult>;
  getPlanContent: () => Promise<PlanContentResult>;
  savePlanContent: (markdown: string) => Promise<PlanMutateResult>;
  savePlanToWorkspace: () => Promise<PlanMutateResult>;
  clearPlan: () => Promise<PlanMutateResult>;
  setGoal: (condition: string) => Promise<GoalResult>;
  pauseGoal: () => Promise<GoalResult>;
  resumeGoal: () => Promise<GoalResult>;
  clearGoal: () => Promise<GoalResult>;
  getGoal: () => Promise<GoalInfo | null>;
  // Project-level stage workflow (see register-stage-ipc.ts).
  getStage: () => Promise<StageInfo | null>;
  setStage: (stage: StageId) => Promise<StageSwitchResult>;
  getGraduation: (stage?: StageId) => Promise<GraduationStatus>;
  toggleManualCheck: (checkId: string, value: boolean) => Promise<GraduationStatus | null>;
  listModels: () => Promise<ModelInfo[]>;
  listSessions: () => Promise<SessionInfo[]>;
  resumeSession: (sessionPath: string) => Promise<OpenProjectResult>;
  deleteSession: (sessionPath: string) => Promise<{ ok: boolean; error?: string }>;
  /** Delete all X-agent sessions for a project cwd. */
  deleteProjectSessions: (
    projectCwd: string,
  ) => Promise<{ ok: boolean; deleted?: number; error?: string }>;
  /** Close current workspace without deleting session files. */
  closeWorkspace: () => Promise<{ ok: boolean; error?: string }>;
  renameSession: (
    sessionPath: string,
    name: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  getStatus: () => Promise<HostStatus>;
  getToolDetail: (toolCallId: string) => Promise<ToolDetailDto | null>;
  getSessionUsage: () => Promise<SessionUsageSnapshot | null>;
  compactSession: (customInstructions?: string) => Promise<CompactSessionResult>;
  reloadResources: () => Promise<{ ok: boolean; reloaded: boolean; error?: string }>;
  getPrefs: () => Promise<ClientPrefs>;
  setPrefs: (patch: Partial<ClientPrefs>) => Promise<ClientPrefs>;
  /** Returns and clears the startup prefs-recovery notice, if any. */
  getPrefsRecoveryNotice: () => Promise<PrefsRecoveryNotice | null>;
  /** Returns and clears the startup-issue queue (recover / bridge / package install). */
  getStartupReport: () => Promise<StartupIssue[]>;
  getSecretCodecStatus: () => Promise<SecretCodecStatus>;
  checkBash: () => Promise<BashCheckResult>;
  checkBashLiveness: () => Promise<BashLivenessResult>;
  applyBashShellPath: (shellPath?: string) => Promise<BashCheckResult>;
  pickBashShell: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  checkGit: () => Promise<GitCheckResult>;
  checkAuth: () => Promise<AuthStatus>;
  checkPiCli: () => Promise<PiCliStatus>;
  installPiCli: () => Promise<PiCliStatus>;
  listProjectDir: (relPath?: string) => Promise<ListProjectDirResult>;
  readProjectFile: (relPath: string) => Promise<ReadProjectFileResult>;
  revealInFolder: (relPath: string) => Promise<{ ok: boolean; error?: string }>;
  godotRpcStatus: () => Promise<GodotRpcStatusDto>;
  godotRpcStart: () => Promise<GodotRpcStatusDto>;
  godotRpcStop: () => Promise<{ ok: boolean }>;
  godotRpcPing: () => Promise<GodotRpcRequestResult>;
  godotRpcRequest: (
    call: GodotRpcCallDto,
    options?: { clientId?: string | null },
  ) => Promise<GodotRpcRequestResult>;
  godotRpcSetActiveClient: (
    clientId: string | null,
  ) => Promise<{ ok: boolean; status: GodotRpcStatusDto }>;
  pickGodotEditor: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  launchGodotEditor: () => Promise<{
    ok: boolean;
    error?: string;
    port?: number;
    hint?: string;
  }>;
  installGodotRpcAddon: () => Promise<InstallGodotRpcAddonResult>;
  pickGodotScene: () => Promise<{
    ok: boolean;
    path?: string;
    canceled?: boolean;
    error?: string;
  }>;
  listPlugins: (cwd?: string | null) => Promise<PluginItem[]>;
  /** Skills + prompt templates + extension commands for composer `/` autocomplete. */
  listSessionSlashItems: () => Promise<SessionSlashItem[]>;
  readPlugin: (path: string) => Promise<PluginReadResult>;
  writePlugin: (path: string, content: string) => Promise<PluginWriteResult>;
  createPlugin: (input: PluginCreateInput) => Promise<PluginMutateResult>;
  deletePlugin: (path: string) => Promise<{ ok: boolean; error?: string }>;
  revealPlugin: (path: string) => Promise<{ ok: boolean; error?: string }>;
  listProviderProfiles: () => Promise<ProviderProfileSummary[]>;
  getProviderProfile: (id: string) => Promise<ProviderProfile | null>;
  upsertProviderProfile: (
    input: ProviderUpsertInput,
  ) => Promise<{
    ok: boolean;
    profile?: ProviderProfile;
    error?: string;
    /** Profile was written into Pi auth/models (enabled profiles only). */
    syncedToPi?: boolean;
  }>;
  deleteProviderProfile: (id: string) => Promise<{ ok: boolean; error?: string }>;
  setProviderProfileEnabled: (
    id: string,
    enabled: boolean,
  ) => Promise<{ ok: boolean; error?: string; syncedToPi?: boolean }>;
  listProviderPresets: () => Promise<ProviderPreset[]>;
  importExistingProviderProfiles: () => Promise<ProviderImportResult>;
  fetchProviderModels: (input: {
    baseUrl: string;
    apiKey: string;
  }) => Promise<FetchProviderModelsResult>;
  listInstalledPackages: () => Promise<InstalledPackageInfo[]>;
  installPackage: (source: string) => Promise<PackageInstallResult>;
  uninstallPackage: (
    source: string,
  ) => Promise<{ ok: boolean; error?: string; output?: string }>;
  installGodotPiPackage: () => Promise<PackageInstallResult>;
  openPiLogin: () => Promise<{ ok: boolean; error?: string; hint?: string }>;
  /** Open an http(s) URL in the system browser. */
  openExternalUrl: (url: string) => Promise<{ ok: boolean; error?: string }>;
  getUpdateStatus: () => Promise<AppUpdateStatus>;
  checkForUpdates: () => Promise<AppUpdateStatus>;
  downloadUpdate: () => Promise<AppUpdateStatus>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  getUsageSummary: (options?: {
    days?: number;
  }) => Promise<UsageSummary>;
  clearUsageSummary: () => Promise<{ ok: boolean; error?: string }>;
  /** Signal main process that renderer boot finished — closes splash and shows the main window. */
  appReady: () => Promise<{ ok: boolean }>;
};

/**
 * Flat channel methods removed from `window.xAgent` — their functionality lives
 * on the workspace / turn / plan / session / prefs facades. Removing an entry
 * here is safe only if the renderer has no direct callers left (facades are
 * typed against IpcInvokeMap, not XAgentApiFlat).
 */
export const DELETED_FLAT_KEYS = [
  "openProject",
  "prompt",
  "abort",
  "getStatus",
  "newSession",
  "setModel",
  "setSessionMode",
  "getSessionMode",
  "buildPlan",
  "getPlanContent",
  "savePlanContent",
  "savePlanToWorkspace",
  "clearPlan",
  "setGoal",
  "pauseGoal",
  "resumeGoal",
  "clearGoal",
  "getGoal",
  "listModels",
  "listSessions",
  "resumeSession",
  "deleteSession",
  "deleteProjectSessions",
  "closeWorkspace",
  "renameSession",
  "previewRetract",
  "retractToUserMessage",
  "editAndResend",
  "regenerateFromUser",
  "getSessionUsage",
  "getPrefsRecoveryNotice",
  "getSecretCodecStatus",
  "compactSession",
  "getToolDetail",
  "reloadResources",
  "listSessionSlashItems",
] as const;

export type DeletedFlatKey = (typeof DELETED_FLAT_KEYS)[number];

/** Every invoke channel keyed by channel name — the generated preload surface. */
export type FlatInvokeApi = { [K in IpcChannelKey]: IpcInvokeMap[K] };

/** Flat IPC surface exposed directly on `window.xAgent` (legacy; prefer facades). */
export type XAgentApiFlat = Omit<FlatInvokeApi, DeletedFlatKey> & {
  notifyAppReady: () => Promise<{ ok: boolean }>;
  onEvent: (handler: (event: UiAgentEvent) => void) => () => void;
  onUpdateStatus: (handler: (status: AppUpdateStatus) => void) => () => void;
  onStageChanged: (handler: (info: StageInfo | null) => void) => () => void;
};

/** Compile-time gate: IpcInvokeMap keys must exactly cover IPC_CHANNELS keys. */
declare const _assertInvokeMapCoverage: Exclude<
  IpcChannelKey,
  keyof IpcInvokeMap
> extends never
  ? Exclude<keyof IpcInvokeMap, IpcChannelKey> extends never
    ? true
    : never
  : never;

/** Compile-time gate: DELETED_FLAT_KEYS entries must be real channel keys. */
declare const _assertDeletedKeysValid: Exclude<
  DeletedFlatKey,
  IpcChannelKey
> extends never
  ? true
  : never;

export interface XAgentApi extends XAgentApiFlat {
  workspace: WorkspaceApi;
  turn: TurnApi;
  plan: PlanApi;
  stage: StageApi;
  session: SessionApi;
  prefs: PrefsApi;
  updates: UpdatesApi;
}

/** Update UX facade. */
export type UpdatesApi = {
  getStatus: IpcInvokeMap["getUpdateStatus"];
  check: IpcInvokeMap["checkForUpdates"];
  download: IpcInvokeMap["downloadUpdate"];
  install: IpcInvokeMap["installUpdate"];
  onStatus: XAgentApiFlat["onUpdateStatus"];
};
