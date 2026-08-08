/**
 * Cross-session Plan journal: persist the active plan file reference keyed by
 * session path, so reopening a session restores the plan in the right panel.
 * Plan files themselves live on disk (~/.pi/agent/x-agent/plans or cwd/.pi/plans);
 * only the in-memory planPath reference was lost across restarts.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ensureAgentDir } from "../prefs";

export type PlanJournalRecord = {
  version: 1;
  sessionPath: string;
  planPath: string;
  updatedAt: number;
};

/** Journal dir is separate from the plans dir (which holds plan files). */
export function getPlanRefsDir(): string {
  return join(ensureAgentDir(), "x-agent", "plan-refs");
}

export function planJournalKey(sessionPath: string): string {
  return createHash("sha256").update(sessionPath).digest("hex").slice(0, 24);
}

export function planJournalPath(sessionPath: string): string {
  return join(getPlanRefsDir(), `${planJournalKey(sessionPath)}.json`);
}

export function savePlanJournal(
  sessionPath: string,
  planPath: string,
): void {
  if (!sessionPath.trim() || !planPath.trim()) return;
  const dir = getPlanRefsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const record: PlanJournalRecord = {
    version: 1,
    sessionPath,
    planPath,
    updatedAt: Date.now(),
  };
  writeFileSync(
    planJournalPath(sessionPath),
    JSON.stringify(record, null, 2),
    "utf8",
  );
}

export function loadPlanJournal(sessionPath: string): string | null {
  if (!sessionPath.trim()) return null;
  const path = planJournalPath(sessionPath);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as PlanJournalRecord;
    if (raw?.version !== 1) return null;
    if (raw.sessionPath !== sessionPath) return null;
    if (typeof raw.planPath !== "string" || !raw.planPath.trim()) return null;
    return raw.planPath;
  } catch {
    return null;
  }
}

export function clearPlanJournal(sessionPath: string): void {
  if (!sessionPath.trim()) return;
  const path = planJournalPath(sessionPath);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
}
