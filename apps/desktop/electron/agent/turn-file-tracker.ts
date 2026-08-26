import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { FileRestoreReport, FileRestoreSkipReason } from "../../shared/ipc";
import { resolveInsideCwd } from "./cwd-sandbox";
import {
  baselineDiffTextForEntry,
  joinBaselineDiffs,
} from "./baseline-diff";
import type {
  RestoreAttempt,
  RestorePreview,
  RestoreSegmentScan,
  RestoreSessionManager,
  RestoreSource,
} from "./restore-source";

export const FILE_BASELINE_CUSTOM_TYPE = "x-agent-file-baselines";
export const MAX_BASELINE_BYTES = 2 * 1024 * 1024;

const MUTATING_TOOLS = new Set(["write", "edit"]);
/** Godot tools that change editor/runtime state (not read-only probes). */
const MUTATING_GODOT_TOOLS = new Set<string>([
  "godot_open_scene",
  "godot_reload_scene",
  "godot_run_scene",
  "godot_run_main_scene",
  "godot_import_resources",
  "godot_stop_scene",
  // 1.2 扩展：会改动编辑器 / 项目状态的工具
  "godot_set_breakpoint",
  "godot_export_project",
  "godot_set_project_setting",
]);

export type SegmentScan = {
  mutationPaths: string[];
  userEntryIds: string[];
  hasBash: boolean;
  hasGodot: boolean;
};

export type BaselinePersistPayload = {
  /** userEntryId → rel path → base64 | null（兼容旧格式：null = absent, base64 = file） */
  turns: Record<string, Record<string, string | null>>;
  /**
   * userEntryId → rel path → symlink target（仅新格式）。
   * 与 turns 互斥：同一 (uid, rel) 不会同时出现在两个表里。
   */
  symlinks?: Record<string, Record<string, string>>;
  /** B9: 增量持久化 —— 自上次 append 以来被删除（撤回）的 turn 列表。 */
  droppedTurns?: string[];
};

/** 内部基线条目：symlink 需记录 target 而非内容 */
type BaselineEntry =
  | { kind: "file"; bytes: Buffer }
  | { kind: "absent" }
  | { kind: "symlink"; target: string };

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
};/**
 * 工具入参键集合，按使用频率排序。
 * - `path` / `file_path` / `filePath` / `file`：通用文件路径
 * - `notebook_path`：Jupyter 风格
 * - `uri` / `dst` / `target`：URI / 目标符号 / 移动目标
 */
const TOOL_PATH_KEYS = [
  "path",
  "file_path",
  "filePath",
  "file",
  "notebook_path",
  "uri",
  "dst",
  "target",
] as const;

/**
 * 从工具入参中识别"被操作的路径"。支持多种键名，避免新工具换键后漏抓导致基线缺失。
 */
function pathFromToolArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const o = args as Record<string, unknown>;
  for (const key of TOOL_PATH_KEYS) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function lstatSyncSafe(abs: string): boolean {
  try {
    lstatSync(abs);
    return true;
  } catch {
    return false;
  }
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
export class TurnFileTracker implements RestoreSource {
  readonly kind = "baseline" as const;
  readonly label = "write/edit 基线";
  readonly fallbackWarning = "write/edit 基线还原失败。";
  private cwd = "";
  /** userEntryId → rel → baseline。第一条 capture 胜出。symlink 单独存 target。 */
  private turnBaselines = new Map<string, Map<string, BaselineEntry>>();
  private oversized = new Set<string>();
  private activeUserEntryId: string | null = null;
  private dirty = false;
  /** B9: 自上次持久化以来变更的 turn（增量 append，避免 O(N²) 全量快照）。 */
  private dirtyTurns = new Set<string>();
  /** B9: 自上次持久化以来被删除的 turn（撤回 drop）。 */
  private droppedTurns = new Set<string>();

  /**
   * 切换项目工作目录。cwd 变更意味着所有旧基线的相对路径已失效，
   * 必须清空避免把旧项目的文件字节还原到新项目目录里。
   */
  setCwd(cwd: string): void {
    this.cwd = cwd;
    this.turnBaselines.clear();
    this.oversized.clear();
    this.activeUserEntryId = null;
    this.dirty = true;
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

  getActiveUserEntryId(): string | null {
    return this.activeUserEntryId;
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
   * 在变更型工具（write / edit）执行前抓取文件基线。
   * 每个 (active turn, rel) 只记录一次。识别 symlink：仅记录 link 自身，
   * 不跟随读 target（否则 symlink 被覆盖后无法还原）。
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
        map.set(rel, { kind: "absent" });
        this.dirty = true;
        this.dirtyTurns.add(this.activeUserEntryId);
        return;
      }
      // lstat 不跟随 symlink：用其判断文件类型
      const lst = lstatSync(resolved.abs);
      if (lst.isSymbolicLink()) {
        try {
          const target = readFileSync(resolved.abs); // symlink 自身即 target 字符串
          map.set(rel, { kind: "symlink", target: target.toString("utf8") });
          this.dirty = true;
          this.dirtyTurns.add(this.activeUserEntryId);
        } catch {
          // readlink on Windows may fail for unprivileged links; fall back to stat
          map.set(rel, { kind: "symlink", target: "" });
          this.dirty = true;
          this.dirtyTurns.add(this.activeUserEntryId);
        }
        return;
      }
      const buf = readFileSync(resolved.abs);
      if (buf.length > MAX_BASELINE_BYTES) {
        this.oversized.add(`${this.activeUserEntryId}:${rel}`);
        return;
      }
      map.set(rel, { kind: "file", bytes: buf });
      this.dirty = true;
      this.dirtyTurns.add(this.activeUserEntryId);
    } catch {
      // ignore capture failures
    }
  }

  /**
   * 扫描 active branch 中 entryId 之后的 segment。
   * 收集 write/edit 触及的相对路径、user turn id 列表，是否含 bash / Godot。
   *
   * **不变量**: 必须在 `session.navigateTree(entryId)` 之前调用. nav 之后
   * abandoned write/edit 不在 active branch,scan 看不到. 这是撤回撤销的
   * 硬时序,见 restore-source.ts 顶部说明. 编排器走 `CompositeRestoreSource.scan`,
   * 不直接调此方法.
   */
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
          if (MUTATING_GODOT_TOOLS.has(name)) hasGodot = true;
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

  /**
   * RestoreSource seam: scan (entryId → segment scan).
   * Mirrors {@link scanSegmentSince} but conforms to the seam's method name
   * so {@link CompositeRestoreSource} can dispatch via duck-typing without
   * expanding the RestoreSource interface to 4 methods.
   *
   * **不变量**: 必须在 `session.navigateTree(entryId)` 之前调用.
   */
  scan(sm: SessionManagerLike, entryId: string): RestoreSegmentScan {
    return this.scanSegmentSince(sm, entryId);
  }

  /**
   * 查找某路径在给定 user turn 列表下是否已有可还原基线。
   * 优先匹配最近的 turn（从前往后），找不到再回落到 `_legacy`。
   */
  private baselineForPath(
    path: string,
    userEntryIds: string[],
  ):
    | { ok: true; entry: BaselineEntry }
    | { ok: false; reason: FileRestoreSkipReason } {
    const ids = [...userEntryIds, "_legacy"];
    for (const uid of ids) {
      if (this.oversized.has(`${uid}:${path}`)) {
        return { ok: false, reason: "too_large" };
      }
      const map = this.turnBaselines.get(uid);
      const e = map?.get(path);
      if (e) return { ok: true, entry: e };
    }
    return { ok: false, reason: "no_baseline" };
  }

  /**
   * @deprecated Use {@link preview} (seam method) — this is the pre-seam
   * implementation. Kept private to enforce seam usage; tests in this module
   * still cover it directly through the public `preview` path.
   */
  private previewRestore(
    sm: SessionManagerLike,
    entryId: string,
  ): {
    restorablePaths: string[];
    unrestorablePaths: string[];
    hasBash: boolean;
    hasGodot: boolean;
    warnings: string[];
    diffText?: string;
    diffTruncated?: boolean;
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
      warnings.push("该段包含会改编辑器状态的 Godot 工具，编辑器内存态无法还原。");
    }
    if (unrestorablePaths.length > 0) {
      warnings.push(
        `${unrestorablePaths.length} 个文件缺少基线，无法自动还原。`,
      );
    }
    // 无 Git 降级：基于 write/edit 基线对比当前盘上内容，产出撤回预览 diff。
    const diffParts: Array<{ rel: string; diffText: string }> = [];
    if (this.cwd) {
      for (const rel of restorablePaths) {
        const hit = this.baselineForPath(rel, scan.userEntryIds);
        if (!hit.ok) continue;
        const res = baselineDiffTextForEntry(rel, hit.entry, this.cwd);
        if ("diffText" in res) diffParts.push({ rel, diffText: res.diffText });
      }
    }
    let diffText: string | undefined;
    let diffTruncated: boolean | undefined;
    if (diffParts.length > 0) {
      const joined = joinBaselineDiffs(diffParts);
      diffText = joined.diffText;
      diffTruncated = joined.truncated;
    }
    return {
      restorablePaths,
      unrestorablePaths,
      hasBash: scan.hasBash,
      hasGodot: scan.hasGodot,
      warnings,
      ...(diffText !== undefined ? { diffText } : {}),
      ...(diffTruncated !== undefined ? { diffTruncated } : {}),
    };
  }

  /** 暴露某回合 write/edit 记录的基线快照（供无 Git 降级 diff 计算）。 */
  getTurnBaselines(
    userEntryId: string,
  ): Array<{ rel: string; entry: BaselineEntry }> {
    const map = this.turnBaselines.get(userEntryId);
    if (!map) return [];
    const out: Array<{ rel: string; entry: BaselineEntry }> = [];
    for (const [rel, entry] of map) {
      out.push({ rel, entry });
    }
    return out;
  }

  /**
   * 无 Git 降级：基于 write/edit 字节基线对比当前盘上内容，
   * 计算某回合的文件改动 diff（与 ShadowCheckpointTracker.diffForTurn 同构）。
   * bash 改盘的文件没有基线，不在返回内（与"无法还原"的降级语义一致）。
   */
  diffTextForTurn(
    userEntryId: string,
  ): { diffText: string; paths: string[]; truncated?: boolean } | null {
    if (!this.cwd) return null;
    const baselines = this.getTurnBaselines(userEntryId);
    if (baselines.length === 0) return null;
    const parts: Array<{ rel: string; diffText: string }> = [];
    const paths: string[] = [];
    for (const { rel, entry } of baselines) {
      const res = baselineDiffTextForEntry(rel, entry, this.cwd);
      if ("diffText" in res) {
        parts.push({ rel, diffText: res.diffText });
        paths.push(rel);
      }
    }
    if (parts.length === 0) return null;
    const joined = joinBaselineDiffs(parts);
    return {
      diffText: joined.diffText,
      paths,
      ...(joined.truncated ? { truncated: true } : {}),
    };
  }

  /**
   * @deprecated Use {@link restore} (seam method). Kept private to enforce
   * seam usage.
   */
  private restorePaths(
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
        switch (hit.entry.kind) {
          case "absent": {
            // 基线是"原本不存在" → 现状是文件 / symlink 都删
            const lst = existsSync(resolved.abs) ? lstatSync(resolved.abs) : null;
            if (lst) {
              unlinkSync(resolved.abs);
              deleted.push(rel);
            }
            break;
          }
          case "symlink": {
            // 还原为 symlink：先清现状，再创建 symlink 指向原 target
            if (existsSync(resolved.abs) || lstatSyncSafe(resolved.abs)) {
              unlinkSync(resolved.abs);
            }
            if (hit.entry.target) {
              symlinkSync(hit.entry.target, resolved.abs);
              restored.push(rel);
            } else {
              // target 为空（极端情况）至少把 link 删除
              deleted.push(rel);
            }
            break;
          }
          case "file": {
            if (existsSync(resolved.abs) || lstatSyncSafe(resolved.abs)) {
              unlinkSync(resolved.abs);
            }
            mkdirSync(dirname(resolved.abs), { recursive: true });
            writeFileSync(resolved.abs, hit.entry.bytes);
            restored.push(rel);
            break;
          }
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

  /** RestoreSource seam: preview — baseline always answers with its own scan. */
  async preview(
    sm: RestoreSessionManager,
    targetUserEntryId: string,
    _scan: RestoreSegmentScan,
  ): Promise<RestorePreview> {
    const p = this.previewRestore(sm, targetUserEntryId);
    return { mode: "baseline", ...p };
  }

  /** RestoreSource seam: restore — replays baselines recorded before mutations. */
  async restore(
    sm: RestoreSessionManager,
    _targetUserEntryId: string,
    scan: RestoreSegmentScan,
  ): Promise<RestoreAttempt> {
    return {
      used: "baseline",
      report: this.restorePaths(scan.mutationPaths, scan.userEntryIds),
    };
  }

  /**
   * @deprecated Internal pre-seam helper — restored via {@link restore}
   * (seam method). Kept private to enforce seam usage.
   *
   * Restore files for a segment still present on the active branch.
   * Production retract scans *before* navigateTree, then calls
   * {@link restorePaths} with that scan — do not call this after nav
   * (abandoned tool calls leave the branch).
   * Call {@link dropBaselinesForTurns} after a successful restore.
   */
  private restoreSegment(sm: SessionManagerLike, entryId: string): {
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
      report.warnings.push(
        "该段包含会改编辑器状态的 Godot 工具，编辑器内存态无法还原。",
      );
    }
    return { report, userEntryIds: scan.userEntryIds };
  }

  /**
   * @deprecated Use {@link restore} (seam method). Kept private to enforce
   * seam usage.
   */
  private restoreSince(sm: SessionManagerLike, entryId: string): FileRestoreReport {
    const { report, userEntryIds } = this.restoreSegment(sm, entryId);
    this.dropBaselinesForTurns(userEntryIds);
    return report;
  }

  /** Drop baselines for turns after a successful retract. */
  dropBaselinesForTurns(userEntryIds: string[]): void {
    for (const uid of userEntryIds) {
      this.turnBaselines.delete(uid);
      // B9: 记录删除以便增量持久化（否则旧快照会把它「复活」）。
      this.droppedTurns.add(uid);
      this.dirtyTurns.delete(uid);
    }
    this.dirty = true;
  }

  /**
   * 把自上次持久化以来的变更追加为 session 的 custom entry（增量）。
   * 文件内容走 turns（base64）；symlink target 走 symlinks 表；
   * 被删除的 turn 走 droppedTurns（loadFromSession 按 entry 顺序先删后合，
   * 旧快照中的已删 turn 不会复活）。
   */
  persistDirty(sm: SessionManagerLike): void {
    if (!this.dirty) return;
    const turns: Record<string, Record<string, string | null>> = {};
    const symlinks: Record<string, Record<string, string>> = {};
    for (const uid of this.dirtyTurns) {
      const map = this.turnBaselines.get(uid);
      if (!map) continue;
      const paths: Record<string, string | null> = {};
      const links: Record<string, string> = {};
      for (const [rel, entry] of map) {
        switch (entry.kind) {
          case "absent":
            paths[rel] = null;
            break;
          case "file":
            paths[rel] = entry.bytes.toString("base64");
            break;
          case "symlink":
            links[rel] = entry.target;
            break;
        }
      }
      turns[uid] = paths;
      if (Object.keys(links).length > 0) symlinks[uid] = links;
    }
    try {
      const payload: BaselinePersistPayload = { turns };
      if (Object.keys(symlinks).length > 0) payload.symlinks = symlinks;
      if (this.droppedTurns.size > 0) {
        payload.droppedTurns = [...this.droppedTurns];
      }
      sm.appendCustomEntry(FILE_BASELINE_CUSTOM_TYPE, payload);
      this.dirty = false;
      this.dirtyTurns.clear();
      this.droppedTurns.clear();
    } catch {
      // non-fatal; dirty flags stay set so the next turn retries
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

      // B9: 增量删除 —— 旧快照中的已删 turn 不得复活（先删后合）。
      if (
        "droppedTurns" in data &&
        Array.isArray((data as BaselinePersistPayload).droppedTurns)
      ) {
        for (const uid of (data as BaselinePersistPayload).droppedTurns!) {
          this.turnBaselines.delete(uid);
        }
      }

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
            if (b64 === null) map.set(key, { kind: "absent" });
            else if (typeof b64 === "string") {
              try {
                map.set(key, {
                  kind: "file",
                  bytes: Buffer.from(b64, "base64"),
                });
              } catch {
                // skip
              }
            }
          }
        }
        // Symlink 表（与 turns 互斥）
        if (
          "symlinks" in data &&
          data.symlinks &&
          typeof data.symlinks === "object"
        ) {
          for (const [uid, links] of Object.entries(data.symlinks)) {
            let map = this.turnBaselines.get(uid);
            if (!map) {
              map = new Map();
              this.turnBaselines.set(uid, map);
            }
            for (const [rel, target] of Object.entries(links)) {
              const key = rel.replace(/\\/g, "/");
              if (map.has(key)) continue;
              if (typeof target === "string") {
                map.set(key, { kind: "symlink", target });
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
          if (b64 === null) map.set(key, { kind: "absent" });
          else if (typeof b64 === "string") {
            try {
              map.set(key, {
                kind: "file",
                bytes: Buffer.from(b64, "base64"),
              });
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
