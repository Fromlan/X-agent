/**
 * StageController — orchestrates the project-level workflow state.
 *
 * Responsibilities:
 *  - Bind / unbind to a project (cwd) and load <cwd>/.x-agent/stage.json
 *  - Switch stages, appending history entries atomically
 *  - Toggle manual graduation checks
 *  - Compute StageInfo bundles (current / history / graduation / artifacts / definition)
 *  - Notify a host when the stage changes so the session can recompute tools
 *    and refresh the system prompt
 *
 * Concurrency: v1 is single-window. The controller is a per-process singleton
 * that locks to a single cwd at a time; calling bind(cwd) again replaces the
 * previous state and emits a `stage-changed` event.
 */
import { STAGE_DEFINITIONS } from "../../../shared/stage-defs";
import {
  DEFAULT_STAGE,
  emptyProjectStage,
  isStageId,
  nextStage,
  type ArtifactSummary,
  type GraduationStatus,
  type ProjectStage,
  type StageDefinition,
  type StageHistoryEntry,
  type StageId,
  type StageInfo,
  type StageSwitchResult,
} from "../../../shared/stage";
import { ensureStageArtifacts, summarizeArtifacts } from "./artifacts";
import { evaluateGraduation } from "./graduation";
import { ensureStageDir, loadStage, saveStage } from "./persistence";

export interface StageChangeListener {
  (info: StageInfo): void;
}

export class StageController {
  private cwd: string | null = null;
  private state: ProjectStage = emptyProjectStage();
  private listeners = new Set<StageChangeListener>();

  /** Bind to a project directory. Loads the existing stage file or defaults to `design`. */
  bind(cwd: string | null): StageInfo | null {
    if (!cwd) {
      this.cwd = null;
      this.state = emptyProjectStage();
      this.emit();
      return null;
    }
    if (this.cwd === cwd) {
      // Same project — return current info without reloading.
      return this.getInfo();
    }
    this.cwd = cwd;
    this.state = loadStage(cwd);
    // Seed default artifacts so the right panel has something to show.
    try {
      ensureStageDir(cwd);
      ensureStageArtifacts(cwd, this.state.current);
    } catch {
      /* seed failures are non-fatal */
    }
    this.emit();
    return this.getInfo();
  }

  /** Return the currently bound cwd (or null). */
  getCwd(): string | null {
    return this.cwd;
  }

  /** Current stage id, or null if no project is bound. */
  getCurrent(): StageId | null {
    return this.cwd ? this.state.current : null;
  }

  /** Full ProjectStage snapshot (in-memory; not the persisted file). */
  getState(): ProjectStage {
    return this.state;
  }

  /** Get the StageDefinition for a stage id (defaults to current). */
  getDefinition(stage?: StageId | null): StageDefinition | null {
    if (stage && isStageId(stage)) return STAGE_DEFINITIONS[stage];
    if (!this.cwd) return null;
    return STAGE_DEFINITIONS[this.state.current] ?? null;
  }

  /** Subscribe to stage changes (bind / setStage / manual toggle). */
  subscribe(fn: StageChangeListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Switch to a different stage. */
  setStage(target: StageId): StageSwitchResult {
    if (!this.cwd) {
      return { ok: false, error: "尚未打开项目" };
    }
    if (!isStageId(target)) {
      return { ok: false, error: `未知阶段：${target}` };
    }
    if (target === this.state.current) {
      const info = this.getInfo();
      return { ok: true, info: info ?? undefined, graduation: this.getGraduation(target) };
    }
    const from = this.state.current;
    const entry: StageHistoryEntry = {
      from,
      to: target,
      at: new Date().toISOString(),
      reason: "user",
    };
    this.state = {
      ...this.state,
      current: target,
      history: [...this.state.history, entry],
      updatedAt: entry.at,
    };
    saveStage(this.cwd, this.state);
    // Seed default artifacts for the new stage so the right panel has content.
    try {
      ensureStageArtifacts(this.cwd, target);
    } catch {
      /* ignore */
    }
    this.emit();
    const info = this.getInfo();
    const graduation = this.getGraduation(from);
    const warning = !graduation.allPassed && graduation.total > 0
      ? `从 ${STAGE_DEFINITIONS[from].shortLabel} 切到 ${STAGE_DEFINITIONS[target].shortLabel} 时，${graduation.total - graduation.passed} 项毕业条件未达标`
      : undefined;
    return { ok: true, info: info ?? undefined, graduation, warning };
  }

  /** Reset to the default stage (used by debug / settings). */
  resetStage(): StageInfo | null {
    if (!this.cwd) return null;
    const entry: StageHistoryEntry = {
      from: this.state.current,
      to: DEFAULT_STAGE,
      at: new Date().toISOString(),
      reason: "user",
    };
    this.state = {
      ...this.state,
      current: DEFAULT_STAGE,
      history: [...this.state.history, entry],
      updatedAt: entry.at,
    };
    saveStage(this.cwd, this.state);
    this.emit();
    return this.getInfo();
  }

  /** Toggle a manual graduation check. */
  toggleManualCheck(checkId: string, value: boolean): GraduationStatus | null {
    if (!this.cwd) return null;
    this.state = {
      ...this.state,
      manualChecks: { ...this.state.manualChecks, [checkId]: value },
      updatedAt: new Date().toISOString(),
    };
    saveStage(this.cwd, this.state);
    this.emit();
    return this.getGraduation(this.state.current);
  }

  /** Compute graduation status for a stage (defaults to current). */
  getGraduation(stage: StageId = this.state.current): GraduationStatus {
    if (!this.cwd) {
      return {
        current: stage,
        next: nextStage(stage),
        checks: [],
        passed: 0,
        total: 0,
        allPassed: false,
        canSkip: true,
      };
    }
    return evaluateGraduation(this.cwd, stage, this.state);
  }

  /** Get the artifact summary for a stage (defaults to current). */
  getArtifacts(stage: StageId = this.state.current): ArtifactSummary {
    if (!this.cwd) {
      return { artifactsDir: "", totalFiles: 0, lastModified: null, files: [] };
    }
    return summarizeArtifacts(this.cwd, stage);
  }

  /** Full UI bundle: current + definition + history + graduation + artifacts. */
  getInfo(): StageInfo | null {
    if (!this.cwd) return null;
    const def = STAGE_DEFINITIONS[this.state.current];
    return {
      current: this.state.current,
      cwd: this.cwd,
      updatedAt: this.state.updatedAt,
      history: this.state.history,
      graduation: this.getGraduation(this.state.current),
      artifacts: this.getArtifacts(this.state.current),
      definition: def,
    };
  }

  private emit(): void {
    const info = this.getInfo();
    if (!info) return;
    for (const fn of this.listeners) {
      try {
        fn(info);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[stage] listener error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

