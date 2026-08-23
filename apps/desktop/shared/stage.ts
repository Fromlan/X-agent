/**
 * Game development workflow stages.
 *
 * A stage is a project-level workflow layer orthogonal to the existing
 * Agent / Ask / Plan / Goal session modes. Each stage supplies a distinct
 * system-prompt append, a recommended tool whitelist, and a preferred
 * right-panel tab so the agent guides a user through game planning,
 * prototyping, testing, and full production.
 *
 * Persistence: <cwd>/.x-agent/stage.json (per project, follows git).
 */

import type { AgentSessionMode } from "./ipc";

export const STAGE_IDS = [
  "design",
  "prototype",
  "test",
  "expand",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

export const DEFAULT_STAGE: StageId = "design";

export const STAGE_LABELS: Record<StageId, string> = {
  design: "策划",
  prototype: "原型",
  test: "测试",
  expand: "扩充",
};

export const STAGE_DESCRIPTIONS: Record<StageId, string> = {
  design: "扩展灵感、完善方案、补充配置",
  prototype: "拆分方案，制作最小可玩原型",
  test: "游玩原型，debug + 简单完善",
  expand: "正常制作，X-agent 全功能",
};

export function isStageId(value: unknown): value is StageId {
  return (
    typeof value === "string" && (STAGE_IDS as readonly string[]).includes(value)
  );
}

/** Next stage in the workflow; returns null for the last stage. */
export function nextStage(stage: StageId | null | undefined): StageId | null {
  if (!stage) return DEFAULT_STAGE;
  const idx = STAGE_IDS.indexOf(stage);
  if (idx < 0 || idx >= STAGE_IDS.length - 1) return null;
  return STAGE_IDS[idx + 1] ?? null;
}

/** Previous stage in the workflow; returns null for the first stage. */
export function previousStage(stage: StageId | null | undefined): StageId | null {
  if (!stage) return null;
  const idx = STAGE_IDS.indexOf(stage);
  if (idx <= 0) return null;
  return STAGE_IDS[idx - 1] ?? null;
}

export function stageLabel(stage: StageId | null | undefined): string {
  if (!stage) return "未选择阶段";
  return STAGE_LABELS[stage];
}

export function stageDescription(stage: StageId | null | undefined): string {
  if (!stage) return "尚未进入游戏开发流程";
  return STAGE_DESCRIPTIONS[stage];
}

/** Right-panel tab identifiers. */
export const RIGHT_PANEL_TABS = [
  "context",
  "plan",
  "tools",
  "files",
  "godot",
  "design",
  "prototype",
  "test",
] as const;
export type RightPanelTab = (typeof RIGHT_PANEL_TABS)[number];

/** Graduation (毕业) condition kinds. */
export type GraduationCheckKind =
  | "file-exists"
  | "file-count"
  | "glob-count"
  | "manual";

export interface GraduationCheck {
  id: string;
  label: string;
  kind: GraduationCheckKind;
  /** Glob pattern relative to artifactsDir (or cwd if artifactsDir is empty). */
  pattern?: string;
  /** Minimum count for file-count / glob-count checks. */
  min?: number;
  /** Default initial state for manual checks. */
  manualChecked?: boolean;
}

export interface StageHistoryEntry {
  from: StageId | null;
  to: StageId;
  at: string; // ISO timestamp
  reason?: "auto" | "user" | "graduation-met";
}

/** Persisted on disk at <cwd>/.x-agent/stage.json. */
export interface ProjectStage {
  schemaVersion: 1;
  current: StageId;
  history: StageHistoryEntry[];
  manualChecks: Record<string, boolean>;
  updatedAt: string;
}

/** Default empty state for a new project. */
export function emptyProjectStage(): ProjectStage {
  return {
    schemaVersion: 1,
    current: DEFAULT_STAGE,
    history: [],
    manualChecks: {},
    updatedAt: new Date().toISOString(),
  };
}

/** Per-check result emitted to the UI. */
export interface GraduationCheckResult {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface GraduationStatus {
  current: StageId;
  next: StageId | null;
  checks: GraduationCheckResult[];
  passed: number;
  total: number;
  allPassed: boolean;
  /** Always true in v1: the user chose "建议但不强制". */
  canSkip: boolean;
}

/** Artifacts summary shown in the right panel. */
export interface ArtifactSummary {
  artifactsDir: string;
  totalFiles: number;
  lastModified: string | null; // ISO
  files: string[]; // relative paths (capped)
}

/** UI-facing bundle returned by getStage(). */
export interface StageInfo {
  current: StageId;
  cwd: string;
  updatedAt: string;
  history: StageHistoryEntry[];
  graduation: GraduationStatus;
  artifacts: ArtifactSummary;
  /** Stage definition (label, description, system append, tool preset). */
  definition: StageDefinition;
}

export type StageToolPreset =
  | "readonly-design"
  | "prototype-write"
  | "test-debug"
  | "full";

export type StageSkillPreset = "all" | "design" | "prototype" | "test" | "full";

export interface StageDefinition {
  id: StageId;
  label: string;
  shortLabel: string;
  description: string;
  icon: "lightbulb" | "box" | "flask-conical" | "rocket";
  defaultMode: AgentSessionMode;
  toolPreset: StageToolPreset;
  skillPreset: StageSkillPreset;
  systemAppend: string;
  rightPanelTabs: RightPanelTab[];
  preferredRightPanelTab: RightPanelTab;
  graduation: GraduationCheck[];
  /** Stage artifact directory, relative to cwd ("" means no dedicated dir). */
  artifactsDir: string;
  /** CSS color token for the stage progress bar. */
  color: string;
}

/** Result of setStage. */
export interface StageSwitchResult {
  ok: boolean;
  info?: StageInfo;
  graduation?: GraduationStatus;
  warning?: string;
  error?: string;
}
