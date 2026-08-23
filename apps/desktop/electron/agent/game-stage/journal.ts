/**
 * Project-level game stage journal.
 *
 * The stage belongs to a project (cwd), not to a single chat session. This
 * module persists the active stage under ~/.pi/agent/x-agent/game-stages so
 * reopening the project restores the same workflow position.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ensureAgentDir } from "../prefs";
import { normalizeProjectKey } from "../../../shared/project-path";
import { writeJsonAtomicSync } from "../lib/atomic-write";
import type { GameStage } from "../../../shared/game-stage";
import { isGameStage } from "../../../shared/game-stage";

export type GameStageJournalRecord = {
  version: 1;
  cwd: string;
  stage: GameStage;
  updatedAt: number;
};

export function getGameStagesDir(): string {
  return join(ensureAgentDir(), "x-agent", "game-stages");
}

export function gameStageKey(cwd: string): string {
  return createHash("sha256")
    .update(normalizeProjectKey(cwd) || cwd.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

export function gameStagePath(cwd: string): string {
  return join(getGameStagesDir(), `${gameStageKey(cwd)}.json`);
}

export function saveGameStageJournal(cwd: string, stage: GameStage): void {
  if (!cwd.trim()) return;
  const dir = getGameStagesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const record: GameStageJournalRecord = {
    version: 1,
    cwd,
    stage,
    updatedAt: Date.now(),
  };
  try {
    writeJsonAtomicSync(gameStagePath(cwd), record);
  } catch (err) {
    console.warn(
      `[game-stage-journal] 写入失败（${gameStagePath(cwd)}）：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function loadGameStageJournal(cwd: string): GameStage | null {
  if (!cwd.trim()) return null;
  const path = gameStagePath(cwd);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as GameStageJournalRecord;
    if (raw?.version !== 1) return null;
    if (normalizeProjectKey(raw.cwd) !== normalizeProjectKey(cwd)) return null;
    if (!isGameStage(raw.stage)) return null;
    return raw.stage;
  } catch {
    return null;
  }
}

export function clearGameStageJournal(cwd: string): void {
  if (!cwd.trim()) return;
  const path = gameStagePath(cwd);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
}
