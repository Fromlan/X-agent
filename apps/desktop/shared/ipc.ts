/**
 * Shared IPC types between main and renderer.
 *
 * 2026-08-31 收口 (issue #60 主题 D C-301): 原 1475 行 god file 拆出
 * IpcInvokeMap + 9 facade (WorkspaceApi / TurnApi / PlanApi / SessionApi /
 * PrefsApi / AppReportApi / LogoApi / GodotApi / UpdatesApi) + XAgentApi
 * + DELETED_FLAT_KEYS 到 `./ipc-invoke-map.ts`. 本文件剩 ~1250 行, 仍
 * barrel re-export 新文件所有 export, 保持 104 个 consumer import 路径不变.
 */

export {
  type WorkspaceApi,
  type TurnApi,
  type PlanApi,
  type SessionApi,
  type PrefsApi,
  type AppReportApi,
  type LogoApi,
  type GodotApi,
  type UpdatesApi,
  type IpcInvokeMap,
  type FlatInvokeApi,
  type XAgentApiFlat,
  type XAgentApi,
  type DeletedFlatKey,
  DELETED_FLAT_KEYS,
} from "./ipc-invoke-map";

import { Type } from "typebox";
import type {
  GodotRpcBridgeStatus,
  GodotRpcCall,
} from "./godot-rpc";
import type { IpcChannelKey } from "./ipc-channels";
export type { IpcChannelKey } from "./ipc-channels";
import type { SessionType } from "./session-type";
export {
  SESSION_TYPES,
  SESSION_TYPE_LABELS,
  DEFAULT_SESSION_TYPE,
  isSessionType,
  coerceSessionType,
} from "./session-type";
export type { SessionType } from "./session-type";

export type AgentStatus = "idle" | "streaming" | "retrying" | "error";

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/** Thinking levels in UI display order (low 鈫?high intensity). */
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
  /**
   * 妯″瀷鎺ュ彈鐨勮緭鍏ョ被鍨?(涓?Pi SDK `Model.input` 瀵归綈).
   *
   * - `["text"]`           : 绾枃鏈ā鍨?
   * - `["text", "image"]`  : 澶氭ā鎬佹ā鍨?
   *
   * 閮ㄥ垎 provider (渚嬪 mistral-conversations) 浼氬熀浜庤瀛楁鍦?user message
   * 鍚?image 鏃舵妸鏁存潯 message 鏇挎崲涓?`(image omitted: model does not support
   * images)` 鍗犱綅鏂囨湰 鈥斺€?X-agent 渚у繀椤昏兘璇诲埌璇ュ瓧娈?鎵嶈兘鍦?send 鍓?
   * 缁欏嚭"褰撳墠妯″瀷涓嶆敹鍥?鐨勬槑纭弽棣?鑰屼笉鏄 AI 鍦ㄥ洖搴旈噷璇?鐪嬩笉鍒板浘"銆?
   *
   * 缂虹渷 = 鏈煡,娌跨敤绾枃鏈垽鏂?(淇濆畧:涓嶅亣璁炬敮鎸?銆?
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
  // 1.2 鎵╁睍锛氬満鏅唴鐪侊紙鍙锛?
  "godot_get_scene_tree",
  "godot_get_node_properties",
  // 1.2 鎵╁睍锛氳皟璇曞櫒 / 璧勬簮娌荤悊 / 瀵煎嚭 / 閰嶇疆璇诲啓 / lint
  "godot_get_debugger_state",
  "godot_set_breakpoint",
  "godot_find_unused_resources",
  "godot_export_project",
  "godot_get_project_setting",
  "godot_set_project_setting",
  "godot_lint_scripts",
  // 1.3 鎵╁睍锛氬彧璇绘枃浠跺唴鐪?/ UID / 绫诲悕 / 鑴氭湰鍙嶅皠 / 瀵煎嚭棰勬
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

/** Session interaction mode 鈥?mutually exclusive. */
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
  /** Entered Goal mode but no condition yet 鈥?UI should prompt for one. */
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
  default: "榛樿",
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
  /**
   * Whether the left session sidebar is collapsed to icon-only mode (56px).
   * Auto-expands below the narrow-window threshold (鈮?60px).
   */
  sidebarCollapsed?: boolean;
  /** Right tool panel width in px. */
  rightPanelWidth: number;
  /**
   * Project keys (`normalizeProjectKey`) hidden from the sidebar.
   * Session files are kept; opening the project again removes the key.
   */
  hiddenProjectKeys: string[];
  /**
   * Project keys that opted out of the Godot ready-checklist steps (鈥滀笉鍐嶆彁閱掆€?.
   * Closing the strip only hides it for the current session.
   */
  dismissedReadyChecklistKeys: string[];
  /**
   * Project keys where the "enable Godot editor tools" nudge was dismissed.
   */
  dismissedGodotToolsNudgeKeys: string[];
  /**
   * Auto-compact when context occupancy percent reaches this threshold (1鈥?00).
   * `0` disables automatic compression.
   */
  autoCompactPercent: number;
  /**
   * Goal mode auto-continue turn budget (1鈥?00). Soft-stops with
   * `budget_limited` when reached; user can raise and resume.
   */
  goalMaxTurns: number;
  /**
   * Goal mode auto-continue token budget (10_000鈥?0_000_000). Soft-stops with
   * `budget_limited` when reached; user can raise and resume.
   */
  goalMaxTokens: number;
  /**
   * User-selected client logo. See `ClientLogoId` for the encoding.
   * Persisted as-is; unknown values fall back to `"default"` at load time.
   */
  clientLogoId: string;
}

export const DEFAULT_PREFS: ClientPrefs = {
  themeId: "default",
  colorMode: "dark",
  showThinking: true,
  lastProjectPath: null,
  lastSessionPath: null,
  // 榛樿渚涘簲鍟?妯″瀷鐣欑┖锛氶鍚姩浼氭寜"宸查厤缃殑 Pi 璁よ瘉"鎴栫敤鎴峰湪"璁剧疆 鈫?渚涘簲鍟?涓殑閫夋嫨
  // 鍐冲畾锛岄伩鍏嶇粰铏氭瀯鐨?deepseek-v4-flash"璧嬩簣铏氬亣鍚堟硶韬唤銆傚凡瀛樺湪鐨?prefs 鏂囦欢淇濈暀鏃у€硷紝
  // 杩佺Щ鐢?SessionHost.createSession 鐨?fallback 閾鹃€氱煡 + 鑷姩閲嶅啓銆?
  provider: null,
  model: null,
  thinkingLevel: "high",
  tools: [...AVAILABLE_TOOLS],
  disabledSkills: [],
  godotEditorPath: null,
  rightPanelOpen: false,
  sidebarWidth: 260,
  sidebarCollapsed: false,
  rightPanelWidth: 360,
  hiddenProjectKeys: [],
  dismissedReadyChecklistKeys: [],
  dismissedGodotToolsNudgeKeys: [],
  autoCompactPercent: 0,
  goalMaxTurns: DEFAULT_GOAL_MAX_TURNS,
  goalMaxTokens: DEFAULT_GOAL_MAX_TOKENS,
  clientLogoId: "default",
};

/**
 * Runtime validation schemas for IPC `setPrefs` payloads.
 * - ClientPrefsSchema: strict,鎵€鏈夊瓧娈甸潪 optional(璇诲彇宸?normalize 鐨勫畬鏁?prefs)
 * - ClientPrefsPatchSchema: 鎺ュ彈閮ㄥ垎瀛楁 + additionalProperties:false,鎷掔粷浠讳綍鏈０鏄庨敭
 *
 * 鐢?`app-runtime.ts` 涓?setPrefs handler 鍏ュ彛閫氳繃 `Value.Check` 鏍￠獙 patch,
 * 鎷掔粷琚敾闄风殑 renderer 鍐欏叆浠绘剰瀛楁(濡?godotEditorPath銆乴astProjectPath銆乻hellPath)銆?
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
  sidebarCollapsed: Type.Optional(Type.Boolean()),
  rightPanelWidth: Type.Number(),
  hiddenProjectKeys: Type.Array(Type.String()),
  dismissedReadyChecklistKeys: Type.Array(Type.String()),
  dismissedGodotToolsNudgeKeys: Type.Array(Type.String()),
  autoCompactPercent: Type.Number(),
  goalMaxTurns: Type.Number(),
  goalMaxTokens: Type.Number(),
  // Encoded as a free-form string; renderer side filters against the known
  // preset/custom list. Loose string schema here keeps IPC handler small and
  // lets new presets/customs flow through without schema bumps.
  clientLogoId: Type.String(),
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
 * Pi SDK type directly 鈥?keeps the renderer bundle free of
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
 * Payload for the renderer 鈫?main `prompt` IPC. `text` is required
 * but may be empty when `images` carries the message (e.g. paste a
 * screenshot with no caption). main-side rejects the call when both
 * are empty.
 */
export interface PromptPayload {
  text: string;
  images?: ImageContent[];
}

/** Serializable chat history item shared by main 鈫?renderer. */
export type HistoryItem =
  | {
      kind: "user";
      id: string;
      text: string;
      entryId?: string;
      /**
       * 宸查檮鍥剧墖 (绮樿创鎴浘 / 鎷栨斁鍥剧墖). 鐢?renderer 鍦?appendPendingUser 鏃?
       * 鍐欏叆;涓昏繘绋?user_message 浜嬩欢涓嶅甫杩欎釜瀛楁,apply-events 鍚堝苟鏃朵繚鐣?
       * 宸叉湁 images 涓嶅姩 (#42 淇 #2:璁?user bubble 鏄剧ず宸查檮鍥?銆?
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
      /** Pi session tree entry id (for regenerate 鈫?preceding user). */
      entryId?: string;
      /** Preceding user message entry id on the active branch. */
      userEntryId?: string;
      /** Unified diff of the turn (shadow pre鈫抪ost), attached after turn_end. */
      diffText?: string;
      /** Rel-paths changed in this turn (shadow pre鈫抪ost). */
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
 * Stable keys for "replaceable" notice bubbles (mode / model / tools / 鈥?.
 * Same key replaces the previous bubble in the transcript; different keys stack.
 *
 * Single source 鈥?host bag 瀛愮紪鎺掑櫒閮?import 杩欎竴涓?閬垮厤 drift.
 * 2026-08-31 鏀跺彛 (issue #59 涓婚 A C-108). 涔嬪墠 lifecycle.ts / controller.ts
 * / session-host.ts 3 澶勬墜鎶?controller 杩樻紡浜?"extension".
 */
export type NoticeReplaceKey =
  | "session_mode"
  | "model"
  | "tools"
  | "resources"
  | "plan"
  | "goal_eval"
  | "session"
  | "extension";

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
  /** Unified diff (pre鈫扝EAD+worktree) of restorable paths; shadow mode only. */
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
      /** Rel-paths changed in this turn (shadow pre鈫抪ost). */
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
       * Pi will silently clamp back to `off` (issue #30: thinking 鍒囨崲琚潤榛樺洖寮?.
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
  /** See {@link UiAgentEvent} session_info 鈥?for the renderer to filter the
   *  Composer thinking SelectMenu. Falls back to all THINKING_LEVELS when the
   *  bundle is missing (no project open). */
  availableThinkingLevels?: ThinkingLevel[];
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
  /** C1: 璇锋眰瀹為檯閫佽揪鐨勫鎴风 id锛坧referred 鏈壌鏉冩椂鐨?fallback锛夈€?*/
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
   * 鐩樹笂瀵嗘枃锛坰afeStorage 瑙ｄ笉寮€鏃剁殑淇濈暀鍓湰锛夈€?
   * 瑙ｅ瘑澶辫触鏃?apiKey 涓虹┖銆佹瀛楁淇濈暀鍘?`enc:v1:` 涓诧紝淇濆瓨鏃跺啓鍥炲師瀵嗘枃锛?
   * 閬垮厤銆屾崲鏈哄櫒/瀵嗛挜鐜噸缃€嶅悗浠讳竴娆′繚瀛樻妸瀵嗛挜姘镐箙瑕嗙洊涓㈠け銆?
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
  /** Masked key hint for UI, e.g. sk-鈥xxx */
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
  /** UI grouping 鈥?aligned with cc-switch style categories */
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

/** 1.3 鍚姩鏈熷け璐ユ憳瑕侊紙recover / bridge / package install锛夈€?*/
export type StartupIssueStage =
  | "shadow_recover"
  | "godot_rpc"
  | "godot_pi_install";

export interface StartupIssue {
  stage: StartupIssueStage;
  message: string;
}

/**
 * Logo identifier for the user's client-branding choice.
 *
 * Encoded as a single string in `ClientPrefs.clientLogoId` so prefs round-trip
 * stays simple. Three shapes:
 *   - `"default"`        鈥?original X-agent logo (build/icon.* + public/logo.png)
 *   - `"preset:NN-name"` 鈥?built-in preset under `apps/desktop/public/logos/`
 *   - `"custom:<uuid>"`  鈥?user-uploaded image under
 *                          `~/.pi/agent/x-agent-logos/<uuid>.png`
 *
 * Anything else is treated as `"default"` by `parseLogoId` (defensive).
 */
export type ClientLogoId = string;

export interface LogoPreset {
  /** Always `"preset:NN-<slug>"`. */
  id: string;
  /** Human-readable Chinese label, e.g. "闇撹櫣璧涘崥". */
  label: string;
  /** Renderer-relative path to the 1024脳1024 webp (favicon / full-size). */
  url: string;
  /** Renderer-relative path to the 256脳256 webp thumbnail (settings grid). */
  thumbnailUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface CustomLogo {
  /** Always `"custom:<uuid>"`. */
  id: string;
  /** Display label: `<originalName> 路 YYYY-MM-DD HH:mm`. */
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

export type OpenProjectMode = "continue" | "new";

/** Coarse workspace / session lifecycle facade (facade methods stay on window.xAgent). */
