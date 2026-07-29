/** Shared IPC types between main and renderer. */

import type {
  GodotRpcBridgeStatus,
  GodotRpcCall,
} from "./godot-rpc";

export type AgentStatus = "idle" | "streaming" | "retrying" | "error";

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

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
] as const;

export type GodotToolName = (typeof GODOT_TOOLS)[number];

/** Offline Godot docs search tools (opt-in; not in DEFAULT_PREFS). */
export const GODOT_DOCS_TOOLS = [
  "godot_docs_search",
  "godot_docs_status",
] as const;

export type GodotDocsToolName = (typeof GODOT_DOCS_TOOLS)[number];

export const ALL_TOGGLEABLE_TOOLS = [
  ...AVAILABLE_TOOLS,
  ...GODOT_TOOLS,
  ...GODOT_DOCS_TOOLS,
] as const;

/** Preset godot-docs git branches for settings UI fallback. */
export const GODOT_DOCS_PRESET_BRANCHES = [
  "stable",
  "master",
  "4.7",
  "4.6",
  "4.5",
  "4.4",
  "4.3",
  "3.6",
] as const;

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
  /** Absolute path to Godot editor executable (Godot_*.exe / godot). */
  godotEditorPath: string | null;
  /**
   * godot-docs git branch to clone/search (e.g. stable, master, 3.6).
   * Cached under ~/.pi/agent/x-agent/godot-docs/<branch>/.
   */
  godotDocsBranch: string;
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
  thinkingLevel: "medium",
  tools: [...AVAILABLE_TOOLS],
  godotEditorPath: null,
  godotDocsBranch: "stable",
  rightPanelOpen: false,
  sidebarWidth: 260,
  rightPanelWidth: 360,
  hiddenProjectKeys: [],
};

export interface OpenProjectResult {
  ok: boolean;
  cwd: string;
  sessionId: string;
  model: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
  /** @deprecated Prefer history_replace events; kept for callers that need a snapshot. */
  history?: HistoryItem[];
  warning?: string;
  error?: string;
}

export interface PromptResult {
  ok: boolean;
  error?: string;
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
  /** Restore write/edit baselines for the abandoned segment. Default true. */
  undoFiles?: boolean;
}

export interface RetractPreview {
  ok: boolean;
  error?: string;
  editorText?: string;
  /** Rel-paths that have a restorable baseline. */
  restorablePaths: string[];
  /** Rel-paths touched by write/edit but missing baseline. */
  unrestorablePaths: string[];
  hasBash: boolean;
  hasGodot: boolean;
  warnings: string[];
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
      type: "user_message";
      text: string;
      id?: string;
      entryId?: string;
    }
  | {
      type: "assistant_start";
      messageId: string;
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
    }
  | {
      type: "session_title";
      sessionId: string;
      name: string;
      sessionPath?: string | null;
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

export type GodotDocsBranchStatus =
  | "missing"
  | "ready"
  | "downloading"
  | "error";

export interface GodotDocsStatusDto {
  branch: string;
  root: string;
  status: GodotDocsBranchStatus;
  localBranches: string[];
  /** Docs-useful remote branches from GitHub (stable / master / x.y). */
  remoteBranches: string[];
  /** GitHub source zip URL for the selected branch. */
  downloadUrl: string;
  docsSiteVersion: string;
  error?: string;
}

export interface GodotDocsListRemoteResult {
  ok: boolean;
  branches: string[];
  error?: string;
  status?: GodotDocsStatusDto;
}

export interface GodotDocsMutateResult {
  ok: boolean;
  status?: GodotDocsStatusDto;
  error?: string;
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
}

export interface ProviderProfileSummary {
  id: string;
  name: string;
  providerId: string;
  api: ProviderApiKind;
  baseUrl: string;
  modelCount: number;
  active: boolean;
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
}

export interface XAgentApi {
  openProject: (path?: string) => Promise<OpenProjectResult>;
  prompt: (text: string) => Promise<PromptResult>;
  abort: () => Promise<{ ok: boolean }>;
  previewRetract: (entryId: string) => Promise<RetractPreview>;
  retractToUserMessage: (
    entryId: string,
    options?: RetractOptions,
  ) => Promise<RetractResult>;
  editAndResend: (
    entryId: string,
    text: string,
    options?: RetractOptions,
  ) => Promise<RetractResult>;
  regenerateFromUser: (
    entryId: string,
    options?: RetractOptions,
  ) => Promise<RetractResult>;
  newSession: () => Promise<OpenProjectResult>;
  setModel: (provider: string, id: string) => Promise<{ ok: boolean; error?: string }>;
  setThinkingLevel: (level: ThinkingLevel) => Promise<{ ok: boolean }>;
  listModels: () => Promise<ModelInfo[]>;
  listSessions: () => Promise<SessionInfo[]>;
  resumeSession: (sessionPath: string) => Promise<OpenProjectResult>;
  deleteSession: (sessionPath: string) => Promise<{ ok: boolean; error?: string }>;
  /** Close current workspace without deleting session files. */
  closeWorkspace: () => Promise<{ ok: boolean; error?: string }>;
  renameSession: (
    sessionPath: string,
    name: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  getPrefs: () => Promise<ClientPrefs>;
  setPrefs: (patch: Partial<ClientPrefs>) => Promise<ClientPrefs>;
  checkBash: () => Promise<BashCheckResult>;
  applyBashShellPath: (shellPath?: string) => Promise<BashCheckResult>;
  pickBashShell: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  checkAuth: () => Promise<AuthStatus>;
  checkPiCli: () => Promise<PiCliStatus>;
  installPiCli: () => Promise<PiCliStatus>;
  getStatus: () => Promise<HostStatus>;
  getToolDetail: (toolCallId: string) => Promise<ToolDetailDto | null>;
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
  godotDocsGetStatus: () => Promise<GodotDocsStatusDto>;
  godotDocsListRemoteBranches: (force?: boolean) => Promise<GodotDocsListRemoteResult>;
  godotDocsSetBranch: (branch: string) => Promise<GodotDocsMutateResult>;
  /** Open GitHub source zip URL in the system browser. */
  godotDocsOpenDownloadUrl: (
    branch?: string,
  ) => Promise<{ ok: boolean; url?: string; error?: string }>;
  /** Pick and import a user-downloaded godot-docs .zip. */
  godotDocsImportZip: (
    branch?: string,
  ) => Promise<GodotDocsMutateResult & { canceled?: boolean }>;
  godotDocsRemoveLocal: (branch?: string) => Promise<GodotDocsMutateResult>;
  listPlugins: (cwd?: string | null) => Promise<PluginItem[]>;
  readPlugin: (path: string) => Promise<PluginReadResult>;
  writePlugin: (path: string, content: string) => Promise<PluginWriteResult>;
  createPlugin: (input: PluginCreateInput) => Promise<PluginMutateResult>;
  deletePlugin: (path: string) => Promise<{ ok: boolean; error?: string }>;
  revealPlugin: (path: string) => Promise<{ ok: boolean; error?: string }>;
  reloadResources: () => Promise<{ ok: boolean; reloaded: boolean; error?: string }>;
  listProviderProfiles: () => Promise<ProviderProfileSummary[]>;
  getProviderProfile: (id: string) => Promise<ProviderProfile | null>;
  upsertProviderProfile: (
    input: ProviderUpsertInput,
  ) => Promise<{ ok: boolean; profile?: ProviderProfile; error?: string }>;
  deleteProviderProfile: (id: string) => Promise<{ ok: boolean; error?: string }>;
  activateProviderProfile: (id: string) => Promise<ProviderActivateResult>;
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
  getUpdateStatus: () => Promise<AppUpdateStatus>;
  checkForUpdates: () => Promise<AppUpdateStatus>;
  downloadUpdate: () => Promise<AppUpdateStatus>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  getSessionUsage: () => Promise<SessionUsageSnapshot | null>;
  compactSession: (customInstructions?: string) => Promise<CompactSessionResult>;
  getUsageSummary: (options?: {
    days?: number;
  }) => Promise<UsageSummary>;
  clearUsageSummary: () => Promise<{ ok: boolean; error?: string }>;
  onEvent: (handler: (event: UiAgentEvent) => void) => () => void;
  onUpdateStatus: (handler: (status: AppUpdateStatus) => void) => () => void;
}
