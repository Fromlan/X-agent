/**
 * Cross-session Goal journal: persist pursuing/paused goals keyed by session path.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { GoalInfo } from "../../../shared/ipc";
import { isRestorableGoalStatus } from "../../../shared/ipc";
import { ensureAgentDir } from "../prefs";
import { writeJsonAtomicSync } from "../lib/atomic-write";

export type GoalJournalRecord = {
  version: 1;
  sessionPath: string;
  goal: GoalInfo;
  updatedAt: number;
  ledger?: { userEntryId: string | null; tokens: number; turnIncremented: boolean }[];
};

export function getGoalsDir(): string {
  return join(ensureAgentDir(), "x-agent", "goals");
}

export function goalJournalKey(sessionPath: string): string {
  return createHash("sha256").update(sessionPath).digest("hex").slice(0, 24);
}

export function goalJournalPath(sessionPath: string): string {
  return join(getGoalsDir(), `${goalJournalKey(sessionPath)}.json`);
}

export function saveGoalJournal(
  sessionPath: string,
  goal: GoalInfo,
  ledger?: GoalJournalRecord["ledger"],
): void {
  if (!sessionPath.trim()) return;
  const dir = getGoalsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const record: GoalJournalRecord = {
    version: 1,
    sessionPath,
    goal,
    updatedAt: Date.now(),
    ...(ledger ? { ledger } : {}),
  };
  // 1.3 防御：原子写（tmp + rename）避免 crash 半写导致 journal 损坏。
  try {
    writeJsonAtomicSync(goalJournalPath(sessionPath), record);
  } catch (err) {
    console.warn(
      `[goal-journal] 写入失败（${goalJournalPath(sessionPath)}）：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Restore only a structurally valid ledger; callers also compare its sums to the persisted budget. */
export function loadGoalLedger(sessionPath: string): GoalJournalRecord["ledger"] | null {
  try {
    const record = JSON.parse(readFileSync(goalJournalPath(sessionPath), "utf8")) as GoalJournalRecord;
    if (record.sessionPath !== sessionPath || record.version !== 1 || !Array.isArray(record.ledger)) return null;
    if (record.ledger.some((e) => !e || (e.userEntryId !== null && typeof e.userEntryId !== "string") || !Number.isFinite(e.tokens) || e.tokens < 0 || typeof e.turnIncremented !== "boolean")) return null;
    return record.ledger;
  } catch { return null; }
}

export function loadGoalJournal(sessionPath: string): GoalInfo | null {
  if (!sessionPath.trim()) return null;
  const path = goalJournalPath(sessionPath);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as GoalJournalRecord;
    if (raw?.version !== 1 || !raw.goal?.condition) return null;
    if (raw.sessionPath !== sessionPath) return null;
    const status = raw.goal.status;
    if (!isRestorableGoalStatus(status)) {
      return null;
    }
    return {
      condition: String(raw.goal.condition),
      status,
      turns: Math.max(0, Math.floor(Number(raw.goal.turns) || 0)),
      maxTurns: Math.max(
        1,
        Math.floor(Number(raw.goal.maxTurns) || 20),
      ),
      tokensUsed: Math.max(0, Math.floor(Number(raw.goal.tokensUsed) || 0)),
      maxTokens: Math.max(
        10_000,
        Math.floor(Number(raw.goal.maxTokens) || 500_000),
      ),
      lastReason: raw.goal.lastReason,
      startedAt:
        typeof raw.goal.startedAt === "number"
          ? raw.goal.startedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearGoalJournal(sessionPath: string): void {
  if (!sessionPath.trim()) return;
  const path = goalJournalPath(sessionPath);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
}
