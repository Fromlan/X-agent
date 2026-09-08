/**
 * shared/ipc 子模块 — 客户端偏好 (issue #60 主题 D C-301).
 *
 * 包含:
 *   - Theme 主题族 (THEME_IDS / ThemeId / ColorMode / THEME_LABELS + 3 个 guard)
 *   - ClientPrefs 完整字段 + DEFAULT_PREFS 默认值
 *   - TypeBox ClientPrefsSchema / ClientPrefsPatchSchema 运行时校验
 *
 * 重要的 #1 加的字段 (issue #1 Goal evaluator 小模型) 必须保留:
 *   - ClientPrefs.goalEvaluatorModel: string | null
 *   - DEFAULT_PREFS.goalEvaluatorModel: null
 *   - ClientPrefsSchema.goalEvaluatorModel: Type.Union([Type.Null(), Type.String()])
 *
 * themeId 字段的 "cindy" 旧值兼容由 normalizeThemePrefs 处理 (重命名
 * 为 "default"); ClientPrefsSchema 不需要做这个 fallback, 因为 schema
 * 只校验写入的新值, 旧值已经在 normalize 阶段被替换.
 */
import { Type } from "typebox";
import { AVAILABLE_TOOLS } from "../tools/available";
import {
  DEFAULT_GOAL_MAX_TOKENS,
  DEFAULT_GOAL_MAX_TURNS,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "./types";

// -----------------------------------------------------------------------
// Theme
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// ClientPrefs
// -----------------------------------------------------------------------

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
   * Auto-expands below the narrow-window threshold (≤ 460px).
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
   * Project keys that opted out of the Godot ready-checklist steps ("不再提醒").
   * Closing the strip only hides it for the current session.
   */
  dismissedReadyChecklistKeys: string[];
  /**
   * Project keys where the "enable Godot editor tools" nudge was dismissed.
   */
  dismissedGodotToolsNudgeKeys: string[];
  /**
   * Auto-compact when context occupancy percent reaches this threshold (1-100).
   * `0` disables automatic compression. The auto-maintain flow is:
   *   1. Snip oversized tool results (see `autoSnipThreshold`).
   *   2. If still above threshold, run `session.compact()`.
   * Inspired by `esengine/DeepSeek-Reasonix` SPEC section 3.6 — "stale tool
   * output is snipped/pruned before summary compaction".
   */
  autoCompactPercent: number;
  /**
   * Tool result messages whose `content` exceeds this many characters get
   * in-place snipped at the auto-maintain pass (head + marker + tail).
   * Default 8192 (~2k tokens) — same threshold as Reasonix's tool-result snip.
   * `0` disables the snip pass (only compaction runs).
   */
  autoSnipThreshold: number;
  /** Number of characters to keep at the head of a snipped tool result. */
  autoSnipHeadKeep: number;
  /** Number of characters to keep at the tail of a snipped tool result. */
  autoSnipTailKeep: number;
  /**
   * Goal mode auto-continue turn budget (1–100). Soft-stops with
   * `budget_limited` when reached; user can raise and resume.
   */
  goalMaxTurns: number;
  /**
   * Goal mode auto-continue token budget (10_000–10_000_000). Soft-stops with
   * `budget_limited` when reached; user can raise and resume.
   */
  goalMaxTokens: number;
  /**
   * Optional dedicated small/fast model for the Goal-mode yes/no evaluator
   * (issue #1). Encoded as `"<provider>/<modelId>"` (matches the
   * `<provider>/<modelId>` key shown in the TopBar). `null` (default) means
   * fall back to the session model for evaluator prompts — i.e. current
   * behavior. When set, the controller resolves it against
   * `ModelRuntime.getModel(provider, modelId)`; an unresolvable value falls
   * back to the session model and emits a one-time warning.
   */
  goalEvaluatorModel: string | null;
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
  // 默认供应商/模型留空:首次启动会按"已配置的 Pi 认证"或用户在"设置 → 供应商"中的选择
  // 决定,避免给铏氭瀯的"deepseek-v4-flash"赋予铏氬亣合法身份。已存在的 prefs 文件保留旧值,
  // 迁移由 SessionHost.createSession 的 fallback 闸通 + 自动重写。
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
  autoCompactPercent: 80,
  autoSnipThreshold: 8192,
  autoSnipHeadKeep: 4096,
  autoSnipTailKeep: 1024,
  goalMaxTurns: DEFAULT_GOAL_MAX_TURNS,
  goalMaxTokens: DEFAULT_GOAL_MAX_TOKENS,
  goalEvaluatorModel: null,
  clientLogoId: "default",
};

// -----------------------------------------------------------------------
// Runtime validation schemas (TypeBox) for IPC setPrefs payload
// -----------------------------------------------------------------------

/**
 * Runtime validation schemas for IPC `setPrefs` payloads.
 * - ClientPrefsSchema: strict,所有字段非 optional(读取后已 normalize 的完整 prefs)
 * - ClientPrefsPatchSchema: 接受部分字段 + additionalProperties:false,拒绝任何未声明键
 *
 * 由 `app-runtime.ts` 中 setPrefs handler 入口通过 `Value.Check` 校验 patch,
 * 拒绝被攻陷的 renderer 写入任意字段(如 godotEditorPath、lastProjectPath、shellPath).
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
    (THINKING_LEVELS as unknown as readonly string[]).map((l) =>
      Type.Literal(l),
    ) as never,
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
  autoSnipThreshold: Type.Number(),
  autoSnipHeadKeep: Type.Number(),
  autoSnipTailKeep: Type.Number(),
  goalMaxTurns: Type.Number(),
  goalMaxTokens: Type.Number(),
  // Optional dedicated evaluator model (issue #1). Loose string schema so the
  // IPC handler doesn't have to track every "<provider>/<modelId>" pair that
  // appears in a model list; the controller resolves it against the runtime
  // and falls back to the session model on miss.
  goalEvaluatorModel: Type.Union([Type.Null(), Type.String()]),
  // Encoded as a free-form string; renderer side filters against the known
  // preset/custom list. Loose string schema here keeps IPC handler small and
  // lets new presets/customs flow through without schema bumps.
  clientLogoId: Type.String(),
});

export const ClientPrefsPatchSchema = Type.Partial(ClientPrefsSchema, {
  additionalProperties: false,
});
