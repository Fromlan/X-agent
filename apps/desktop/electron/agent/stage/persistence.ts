/**
 * Project-level stage persistence.
 *
 * The stage is a project-level workflow state, not a session-local journal.
 * We persist it at <cwd>/.x-agent/stage.json (follows git so teammates share
 * the workflow position). Atomic writes via lib/atomic-write so a crash
 * mid-write can't corrupt the file.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeJsonAtomicSync } from "../lib/atomic-write";
import {
  DEFAULT_STAGE,
  emptyProjectStage,
  isStageId,
  type ProjectStage,
  type StageHistoryEntry,
  type StageId,
} from "../../../shared/stage";

const STAGE_DIRNAME = ".x-agent";
const STAGE_FILENAME = "stage.json";

/** Path to the project's stage file. */
export function stageJsonPath(cwd: string): string {
  return join(cwd, STAGE_DIRNAME, STAGE_FILENAME);
}

/** Ensure <cwd>/.x-agent/ exists (idempotent). */
export function ensureStageDir(cwd: string): void {
  if (!cwd) return;
  const dir = join(cwd, STAGE_DIRNAME);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function validateAndMigrate(raw: unknown): ProjectStage | null {
  const obj = asObject(raw);
  if (!obj) return null;
  if (obj["schemaVersion"] !== 1) return null;
  if (!isStageId(obj["current"])) return null;
  if (!Array.isArray(obj["history"])) return null;
  if (!asObject(obj["manualChecks"])) return null;
  if (typeof obj["updatedAt"] !== "string") return null;

  const validatedHistory: StageHistoryEntry[] = [];
  for (const entry of obj["history"]) {
    const eObj = asObject(entry);
    if (!eObj) return null;
    const from = eObj["from"];
    const to = eObj["to"];
    const at = eObj["at"];
    if (typeof at !== "string") return null;
    if (!isStageId(to)) return null;
    validatedHistory.push({
      from: from && isStageId(from) ? from : null,
      to: to as StageId,
      at,
      reason:
        eObj["reason"] === "auto" ||
        eObj["reason"] === "user" ||
        eObj["reason"] === "graduation-met"
          ? eObj["reason"]
          : undefined,
    });
  }

  const validatedChecks: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(obj["manualChecks"] as Record<string, unknown>)) {
    if (typeof v === "boolean") validatedChecks[k] = v;
  }

  return {
    schemaVersion: 1,
    current: obj["current"],
    history: validatedHistory,
    manualChecks: validatedChecks,
    updatedAt: obj["updatedAt"],
  };
}

/** Load the project's stage, returning a fresh default if the file is missing or invalid. */
export function loadStage(cwd: string): ProjectStage {
  if (!cwd) return emptyProjectStage();
  const path = stageJsonPath(cwd);
  if (!existsSync(path)) return { ...emptyProjectStage(), current: DEFAULT_STAGE };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const validated = validateAndMigrate(raw);
    if (validated) return validated;
    // Invalid — back it up so the user can recover, then start fresh.
    try {
      const backup = `${path}.bak-${Date.now()}`;
      const original = readFileSync(path, "utf8");
      mkdirSync(dirname(backup), { recursive: true });
      writeFileSync(backup, original, "utf8");
      unlinkSync(path);
      // eslint-disable-next-line no-console
      console.warn(`[stage] Invalid stage.json, backed up to ${backup}`);
    } catch {
      /* ignore backup failure */
    }
    return { ...emptyProjectStage(), current: DEFAULT_STAGE };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[stage] Failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ...emptyProjectStage(), current: DEFAULT_STAGE };
  }
}

/** Persist the project's stage atomically. */
export function saveStage(cwd: string, stage: ProjectStage): void {
  if (!cwd) return;
  ensureStageDir(cwd);
  const path = stageJsonPath(cwd);
  try {
    writeJsonAtomicSync(path, stage);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[stage] Failed to write ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Delete the project's stage file (used by clear / debug only). */
export function clearStage(cwd: string): void {
  if (!cwd) return;
  const path = stageJsonPath(cwd);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}
