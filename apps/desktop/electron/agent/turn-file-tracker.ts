import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { FileRestoreReport, FileRestoreSkipReason } from "../../shared/ipc";
import { resolveInsideCwd } from "./project-path";

export const FILE_BASELINE_CUSTOM_TYPE = "x-agent-file-baselines";
export const MAX_BASELINE_BYTES = 2 * 1024 * 1024;

const MUTATING_TOOLS = new Set(["write", "edit"]);

export type SegmentScan = {
  mutationPaths: string[];
  userEntryIds: string[];
  hasBash: boolean;
  hasGodot: boolean;
};

export type BaselinePersistPayload = {
  /** userEntryId → rel path → base64 | null */
  turns: Record<string, Record<string, string | null>>;
};

type SessionEntryLike = {
  type: string;
  id: string;
  customType?: string;
  data?: unknown;
  message?: {
    role?: string;
    content?: unknown;
    toolName?: string;
  };
};

type SessionManagerLike = {
  getBranch: (fromId?: string) => SessionEntryLike[];
  getEntries: () => SessionEntryLike[];
  getEntry: (id: string) => SessionEntryLike | undefined;
  appendCustomEntry: (customType: string, data?: unknown) => string;
};

function pathFromToolArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const o = args as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath", "file"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function toolCallsFromAssistantContent(
  content: unknown,
): Array<{ name: string; args: unknown }> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ name: string; args: unknown }> = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as {
      type?: string;
      name?: string;
      arguments?: unknown;
      args?: unknown;
    };
    if (p.type !== "toolCall") continue;
    out.push({
      name: p.name ?? "",
      args: p.arguments ?? p.args,
    });
  }
  return out;
}

/**
 * Tracks pre-mutation file bytes per user-turn so retract can restore them.
 */
export class TurnFileTracker {
  private cwd = "";
  /** userEntryId → rel → baseline (null = did not exist). First capture per turn wins. */
  private turnBaselines = new Map<string, Map<string, Buffer | null>>();
  private oversized = new Set<string>();
  private activeUserEntryId: string | null = null;
  private dirty = false;

  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  clear(): void {
    this.turnBaselines.clear();
    this.oversized.clear();
    this.activeUserEntryId = null;
    this.dirty = false;
  }

  setActiveUserEntryId(entryId: string | null): void {
    this.activeUserEntryId = entryId;
  }

  hasBaseline(rel: string, userEntryId?: string): boolean {
    const key = rel.replace(/\\/g, "/");
    if (userEntryId) {
      return this.turnBaselines.get(userEntryId)?.has(key) ?? false;
    }
    for (const map of this.turnBaselines.values()) {
      if (map.has(key)) return true;
    }
    return false;
  }

  /**
   * Capture baseline before a mutating tool runs (once per path per active turn).
   */
  captureBeforeTool(toolName: string, args: unknown): void {
    if (!MUTATING_TOOLS.has(toolName)) return;
    if (!this.cwd || !this.activeUserEntryId) return;
    const raw = pathFromToolArgs(args);
    if (!raw) return;
    const resolved = resolveInsideCwd(this.cwd, raw);
    if (!resolved.ok || !resolved.rel) return;
    const rel = resolved.rel;
    if (this.oversized.has(`${this.activeUserEntryId}:${rel}`)) return;

    let map = this.turnBaselines.get(this.activeUserEntryId);
    if (!map) {
      map = new Map();
      this.turnBaselines.set(this.activeUserEntryId, map);
    }
    if (map.has(rel)) return;

    try {
      if (!existsSync(resolved.abs)) {
        map.set(rel, null);
        this.dirty = true;
        return;
      }
      const buf = readFileSync(resolved.abs);
      if (buf.length > MAX_BASELINE_BYTES) {
        this.oversized.add(`${this.activeUserEntryId}:${rel}`);
        return;
      }
      map.set(rel, buf);
      this.dirty = true;
    } catch {
      // ignore capture failures
    }
  }

  scanSegmentSince(sm: SessionManagerLike, entryId: string): SegmentScan {
    const branch = sm.getBranch();
    const idx = branch.findIndex((e) => e.id === entryId);
    const segment = idx >= 0 ? branch.slice(idx) : branch;

    const mutationPaths = new Set<string>();
    const userEntryIds: string[] = [];
    let hasBash = false;
    let hasGodot = false;

    for (const entry of segment) {
      if (entry.type !== "message" || !entry.message) continue;
      const msg = entry.message;
      if (msg.role === "user") {
        userEntryIds.push(entry.id);
        continue;
      }
      if (msg.role === "assistant") {
        for (const call of toolCallsFromAssistantContent(msg.content)) {
          const name = call.name;
          if (name === "bash") hasBash = true;
          if (name.startsWith("godot_")) hasGodot = true;
          if (MUTATING_TOOLS.has(name)) {
            const raw = pathFromToolArgs(call.args);
            if (!raw) continue;
            const resolved = resolveInsideCwd(this.cwd, raw);
            if (resolved.ok && resolved.rel) {
              mutationPaths.add(resolved.rel);
            }
          }
        }
      }
    }

    return {
      mutationPaths: [...mutationPaths],
      userEntryIds,
      hasBash,
      hasGodot,
    };
  }

  private baselineForPath(
    path: string,
    userEntryIds: string[],
  ):
    | { ok: true; bytes: Buffer | null }
    | { ok: false; reason: FileRestoreSkipReason } {
    const ids = [...userEntryIds, "_legacy"];
    for (const uid of ids) {
      if (this.oversized.has(`${uid}:${path}`)) {
        return { ok: false, reason: "too_large" };
      }
      const map = this.turnBaselines.get(uid);
      if (map?.has(path)) {
        return { ok: true, bytes: map.get(path) ?? null };
      }
    }
    return { ok: false, reason: "no_baseline" };
  }

  previewRestore(
    sm: SessionManagerLike,
    entryId: string,
  ): {
    restorablePaths: string[];
    unrestorablePaths: string[];
    hasBash: boolean;
    hasGodot: boolean;
    warnings: string[];
  } {
    const scan = this.scanSegmentSince(sm, entryId);
    const restorablePaths: string[] = [];
    const unrestorablePaths: string[] = [];
    for (const rel of scan.mutationPaths) {
      const hit = this.baselineForPath(rel, scan.userEntryIds);
      if (hit.ok) restorablePaths.push(rel);
      else unrestorablePaths.push(rel);
    }
    const warnings: string[] = [];
    if (scan.hasBash) {
      warnings.push("该段包含 bash，命令副作用无法保证还原。");
    }
    if (scan.hasGodot) {
      warnings.push("该段包含 Godot 工具，编辑器状态无法还原。");
    }
    if (unrestorablePaths.length > 0) {
      warnings.push(
        `${unrestorablePaths.length} 个文件缺少基线，无法自动还原。`,
      );
    }
    return {
      restorablePaths,
      unrestorablePaths,
      hasBash: scan.hasBash,
      hasGodot: scan.hasGodot,
      warnings,
    };
  }

  restorePaths(
    rels: string[],
    userEntryIds: string[],
  ): FileRestoreReport {
    const restored: string[] = [];
    const deleted: string[] = [];
    const skipped: FileRestoreReport["skipped"] = [];
    const warnings: string[] = [];

    if (!this.cwd) {
      return {
        restored,
        deleted,
        skipped: [{ reason: "error", detail: "未打开项目" }],
        warnings: ["未打开项目，无法还原文件"],
      };
    }

    for (const rel of rels) {
      const hit = this.baselineForPath(rel, userEntryIds);
      if (!hit.ok) {
        skipped.push({ path: rel, reason: hit.reason });
        continue;
      }
      const resolved = resolveInsideCwd(this.cwd, rel);
      if (!resolved.ok) {
        skipped.push({
          path: rel,
          reason: "outside_cwd",
          detail: resolved.error,
        });
        continue;
      }
      try {
        if (hit.bytes === null) {
          if (existsSync(resolved.abs)) {
            unlinkSync(resolved.abs);
            deleted.push(rel);
          }
        } else {
          mkdirSync(dirname(resolved.abs), { recursive: true });
          writeFileSync(resolved.abs, hit.bytes);
          restored.push(rel);
        }
      } catch (err) {
        skipped.push({
          path: rel,
          reason: "error",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { restored, deleted, skipped, warnings };
  }

  /**
   * Restore files for a segment without dropping baselines.
   * Call {@link dropBaselinesForTurns} after navigateTree succeeds.
   */
  restoreSegment(sm: SessionManagerLike, entryId: string): {
    report: FileRestoreReport;
    userEntryIds: string[];
  } {
    const scan = this.scanSegmentSince(sm, entryId);
    const report = this.restorePaths(scan.mutationPaths, scan.userEntryIds);
    if (scan.hasBash) {
      report.skipped.push({ reason: "bash_unknown" });
      report.warnings.push("该段包含 bash，命令副作用无法保证还原。");
    }
    if (scan.hasGodot) {
      report.skipped.push({ reason: "godot" });
      report.warnings.push("该段包含 Godot 工具，编辑器状态无法还原。");
    }
    return { report, userEntryIds: scan.userEntryIds };
  }

  restoreSince(sm: SessionManagerLike, entryId: string): FileRestoreReport {
    const { report, userEntryIds } = this.restoreSegment(sm, entryId);
    this.dropBaselinesForTurns(userEntryIds);
    return report;
  }

  /** Drop baselines for turns after a successful retract. */
  dropBaselinesForTurns(userEntryIds: string[]): void {
    for (const uid of userEntryIds) {
      this.turnBaselines.delete(uid);
    }
    this.dirty = true;
  }

  persistDirty(sm: SessionManagerLike): void {
    if (!this.dirty) return;
    const turns: Record<string, Record<string, string | null>> = {};
    for (const [uid, map] of this.turnBaselines) {
      const paths: Record<string, string | null> = {};
      for (const [rel, buf] of map) {
        paths[rel] = buf === null ? null : buf.toString("base64");
      }
      turns[uid] = paths;
    }
    try {
      sm.appendCustomEntry(FILE_BASELINE_CUSTOM_TYPE, {
        turns,
      } satisfies BaselinePersistPayload);
      this.dirty = false;
    } catch {
      // non-fatal
    }
  }

  loadFromSession(sm: SessionManagerLike): void {
    const entries = sm.getEntries();
    for (const entry of entries) {
      if (
        entry.type !== "custom" ||
        entry.customType !== FILE_BASELINE_CUSTOM_TYPE
      ) {
        continue;
      }
      const data = entry.data as
        | BaselinePersistPayload
        | { paths?: Record<string, string | null> }
        | undefined;
      if (!data || typeof data !== "object") continue;

      // New format: per-turn
      if ("turns" in data && data.turns && typeof data.turns === "object") {
        for (const [uid, paths] of Object.entries(data.turns)) {
          let map = this.turnBaselines.get(uid);
          if (!map) {
            map = new Map();
            this.turnBaselines.set(uid, map);
          }
          for (const [rel, b64] of Object.entries(paths)) {
            const key = rel.replace(/\\/g, "/");
            if (map.has(key)) continue;
            if (b64 === null) map.set(key, null);
            else if (typeof b64 === "string") {
              try {
                map.set(key, Buffer.from(b64, "base64"));
              } catch {
                // skip
              }
            }
          }
        }
        continue;
      }

      // Legacy flat format → attach under synthetic turn id
      if ("paths" in data && data.paths && typeof data.paths === "object") {
        const uid = "_legacy";
        let map = this.turnBaselines.get(uid);
        if (!map) {
          map = new Map();
          this.turnBaselines.set(uid, map);
        }
        for (const [rel, b64] of Object.entries(data.paths)) {
          const key = rel.replace(/\\/g, "/");
          if (map.has(key)) continue;
          if (b64 === null) map.set(key, null);
          else if (typeof b64 === "string") {
            try {
              map.set(key, Buffer.from(b64, "base64"));
            } catch {
              // skip
            }
          }
        }
      }
    }
    this.dirty = false;
  }
}

export function pathFromArgsForTest(args: unknown): string | null {
  return pathFromToolArgs(args);
}

export type { FileRestoreSkipReason };
