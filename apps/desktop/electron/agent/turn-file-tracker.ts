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
import { MUTATING_GODOT_TOOLS } from "./godot-tools";
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
const MUTATING_GODOT_TOOLS_SET: ReadonlySet<string> = new Set(MUTATING_GODOT_TOOLS);

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

/** 工具入参键：通用 `path` / `file_path` / `filePath` / `file`、
 *  Jupyter 风格 `notebook_path`、URI / 目标 `uri` / `dst` / `target`。 */
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

/** 从工具入参中识别被操作的路径(多键名扫描,避免新工具换键后漏抓)。 */
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
    const p = part as { type?: string; name?: string; arguments?: unknown; args?: unknown };
    if (p.type !== "toolCall") continue;
    out.push({ name: p.name ?? "", args: p.arguments ?? p.args });
  }
  return out;
}

/** Tracks pre-mutation file bytes per user-turn so retract can restore them. */
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

  /** 切换项目工作目录。cwd 变更意味着所有旧基线的相对路径已失效,
   * 必须清空避免把旧项目的文件字节还原到新项目目录里。 */
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
    const uid = this.activeUserEntryId;
    if (!this.cwd || !uid) return;
    const raw = pathFromToolArgs(args);
    if (!raw) return;
    const resolved = resolveInsideCwd(this.cwd, raw);
    if (!resolved.ok || !resolved.rel) return;
    const rel = resolved.rel;
    if (this.oversized.has(`${uid}:${rel}`)) return;

    let map = this.turnBaselines.get(uid);
    if (!map) {
      map = new Map();
      this.turnBaselines.set(uid, map);
    }
    if (map.has(rel)) return;
    const markDirty = () => {
      this.dirty = true;
      this.dirtyTurns.add(uid);
    };

    try {
      if (!existsSync(resolved.abs)) {
        map.set(rel, { kind: "absent" });
        markDirty();
        return;
      }
      // lstat 不跟随 symlink:用它判文件类型。symlink 自身即 target 字符串;
      // readlink on Windows may fail for unprivileged links → fall back。
      if (lstatSync(resolved.abs).isSymbolicLink()) {
        let target = "";
        try {
          target = readFileSync(resolved.abs).toString("utf8");
        } catch {
          /* keep target empty */
        }
        map.set(rel, { kind: "symlink", target });
        markDirty();
        return;
      }
      const buf = readFileSync(resolved.abs);
      if (buf.length > MAX_BASELINE_BYTES) {
        this.oversized.add(`${uid}:${rel}`);
        return;
      }
      map.set(rel, { kind: "file", bytes: buf });
      markDirty();
    } catch {
      // ignore capture failures
    }
  }

  /**
   * RestoreSource seam: scan (entryId → segment scan).
   * 编排器只调 `scan`,CompositeRestoreSource 通过 RestoreSource 接口
   * (scan 显式声明) 派发,只 baseline 源实现该方法 (mutation tracing
   * 是 tracker 职责,shadow 源不做). 显式可选,不再 duck-type.
   *
   * **不变量**: 必须在 `session.navigateTree(entryId)` 之前调用. nav 之后
   * abandoned write/edit 不在 active branch,scan 看不到. 硬时序见
   * restore-source.ts 顶部说明. (issue #64 主题 C C-104 收口.)
   */
  scan(sm: RestoreSessionManager, entryId: string): RestoreSegmentScan {
    const branch = sm.getBranch();
    const idx = branch.findIndex((e) => e.id === entryId);
    const segment = idx >= 0 ? branch.slice(idx) : branch;
    const mutationPaths = new Set<string>();
    const userEntryIds: string[] = [];
    let hasBash = false;
    let hasGodot = false;
    for (const entry of segment) {
      const msg = entry.message;
      if (!msg) continue;
      if (msg.role === "user") {
        userEntryIds.push(entry.id);
      } else if (msg.role === "assistant") {
        for (const call of toolCallsFromAssistantContent(msg.content)) {
          const name = call.name;
          if (name === "bash") hasBash = true;
          if (MUTATING_GODOT_TOOLS_SET.has(name)) hasGodot = true;
          if (!MUTATING_TOOLS.has(name)) continue;
          const raw = pathFromToolArgs(call.args);
          if (!raw) continue;
          const r = resolveInsideCwd(this.cwd, raw);
          if (r.ok && r.rel) mutationPaths.add(r.rel);
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
   * RestoreSource seam: preview — baseline always answers with its own scan.
   * (issue #64 主题 C C-104 收口:pre-seam `previewRestore` 已并入.)
   */
  async preview(
    sm: RestoreSessionManager,
    targetUserEntryId: string,
    _scan: RestoreSegmentScan,
  ): Promise<RestorePreview> {
    const scan = this.scan(sm, targetUserEntryId);
    const restorable: string[] = [];
    const unrestorable: string[] = [];
    const baselines: Array<{ rel: string; entry: BaselineEntry }> = [];
    for (const rel of scan.mutationPaths) {
      const hit = this.baselineForPath(rel, scan.userEntryIds);
      if (hit.ok) {
        restorable.push(rel);
        if (this.cwd) baselines.push({ rel, entry: hit.entry });
      } else unrestorable.push(rel);
    }
    const warnings: string[] = [];
    if (scan.hasBash) warnings.push("该段包含 bash，命令副作用无法保证还原。");
    if (scan.hasGodot) warnings.push("该段包含会改编辑器状态的 Godot 工具，编辑器内存态无法还原。");
    if (unrestorable.length > 0) warnings.push(`${unrestorable.length} 个文件缺少基线，无法自动还原。`);
    const diff = this.diffForBaselines(baselines);
    return {
      mode: "baseline",
      restorablePaths: restorable,
      unrestorablePaths: unrestorable,
      hasBash: scan.hasBash,
      hasGodot: scan.hasGodot,
      warnings,
      ...(diff?.diffText !== undefined ? { diffText: diff.diffText } : {}),
      ...(diff?.truncated ? { diffTruncated: true } : {}),
    };
  }

  /** 暴露某回合 write/edit 记录的基线快照（供无 Git 降级 diff 计算）。 */
  getTurnBaselines(
    userEntryId: string,
  ): Array<{ rel: string; entry: BaselineEntry }> {
    const map = this.turnBaselines.get(userEntryId);
    if (!map) return [];
    return Array.from(map, ([rel, entry]) => ({ rel, entry }));
  }

  /**
   * 无 Git 降级：基于 write/edit 字节基线对比当前盘上内容，
   * 计算某回合的文件改动 diff（与 ShadowCheckpointTracker.diffForTurn 同构）。
   * bash 改盘的文件没有基线，不在返回内（与"无法还原"的降级语义一致）。
   */
  diffTextForTurn(
    userEntryId: string,
  ): { diffText: string; paths: string[]; truncated?: boolean } | null {
    return this.diffForBaselines(this.getTurnBaselines(userEntryId));
  }

  /** 共享的「基线集合 → diff 文本」实现。空集合 / 无 cwd / 无 diff 都返回 null。 */
  private diffForBaselines(
    baselines: Array<{ rel: string; entry: BaselineEntry }>,
  ): { diffText: string; paths: string[]; truncated?: boolean } | null {
    if (!this.cwd || baselines.length === 0) return null;
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
   * 文件级还原：按 (rel, baseline entry) 落盘 / 删除。`restore` seam 的核心实现。
   * Bash/Godot 警告在 `restore` 中追加,本方法只做 I/O。
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
    // 若 abs 存在(文件 / symlink / 死 symlink),unlink 掉。
    const clearIfPresent = (abs: string) => {
      if (existsSync(abs) || lstatSyncSafe(abs)) unlinkSync(abs);
    };

    for (const rel of rels) {
      const hit = this.baselineForPath(rel, userEntryIds);
      if (!hit.ok) {
        skipped.push({ path: rel, reason: hit.reason });
        continue;
      }
      const resolved = resolveInsideCwd(this.cwd, rel);
      if (!resolved.ok) {
        skipped.push({ path: rel, reason: "outside_cwd", detail: resolved.error });
        continue;
      }
      try {
        const e = hit.entry;
        if (e.kind === "absent") {
          if (existsSync(resolved.abs)) {
            unlinkSync(resolved.abs);
            deleted.push(rel);
          }
        } else if (e.kind === "symlink") {
          clearIfPresent(resolved.abs);
          // target 为空(极端)至少把 link 删除;否则建回原 symlink
          if (e.target) {
            symlinkSync(e.target, resolved.abs);
            restored.push(rel);
          } else {
            deleted.push(rel);
          }
        } else {
          clearIfPresent(resolved.abs);
          mkdirSync(dirname(resolved.abs), { recursive: true });
          writeFileSync(resolved.abs, e.bytes);
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
   * RestoreSource seam: restore — replays baselines recorded before mutations.
   * (issue #64 主题 C C-104 收口:pre-seam `restoreSegment` / `restoreSince` 已并入.)
   * 注:drop baselines 由编排器 (retract-orchestrator) 拥有,本方法只还原。
   */
  async restore(
    _sm: RestoreSessionManager,
    _targetUserEntryId: string,
    scan: RestoreSegmentScan,
  ): Promise<RestoreAttempt> {
    const report = this.restorePaths(scan.mutationPaths, scan.userEntryIds);
    if (scan.hasBash) {
      report.skipped.push({ reason: "bash_unknown" });
      report.warnings.push("该段包含 bash，命令副作用无法保证还原。");
    }
    if (scan.hasGodot) {
      report.skipped.push({ reason: "godot" });
      report.warnings.push("该段包含会改编辑器状态的 Godot 工具，编辑器内存态无法还原。");
    }
    return { used: "baseline", report };
  }

  /** Drop baselines for turns after a successful retract. */
  dropBaselinesForTurns(userEntryIds: string[]): void {
    // B9: droppedTurns 记录删除以便增量持久化（旧快照不得复活）。
    for (const uid of userEntryIds) {
      this.turnBaselines.delete(uid);
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
  persistDirty(sm: RestoreSessionManager): void {
    if (!this.dirty) return;
    const turns: Record<string, Record<string, string | null>> = {};
    const symlinks: Record<string, Record<string, string>> = {};
    for (const uid of this.dirtyTurns) {
      const map = this.turnBaselines.get(uid);
      if (!map) continue;
      const paths: Record<string, string | null> = {};
      const links: Record<string, string> = {};
      for (const [rel, entry] of map) {
        if (entry.kind === "symlink") {
          links[rel] = entry.target;
        } else {
          paths[rel] = entry.kind === "absent" ? null : entry.bytes.toString("base64");
        }
      }
      turns[uid] = paths;
      if (Object.keys(links).length > 0) symlinks[uid] = links;
    }
    try {
      const payload: BaselinePersistPayload = { turns };
      if (Object.keys(symlinks).length > 0) payload.symlinks = symlinks;
      if (this.droppedTurns.size > 0) payload.droppedTurns = [...this.droppedTurns];
      sm.appendCustomEntry(FILE_BASELINE_CUSTOM_TYPE, payload);
      this.dirty = false;
      this.dirtyTurns.clear();
      this.droppedTurns.clear();
    } catch {
      // non-fatal; dirty flags stay set so the next turn retries
    }
  }

  loadFromSession(sm: RestoreSessionManager): void {
    const ensureTurnMap = (uid: string): Map<string, BaselineEntry> => {
      let m = this.turnBaselines.get(uid);
      if (!m) {
        m = new Map();
        this.turnBaselines.set(uid, m);
      }
      return m;
    };
    const decodeFileEntry = (b64: string | null): BaselineEntry | undefined => {
      if (b64 === null) return { kind: "absent" };
      if (typeof b64 !== "string") return undefined;
      try {
        return { kind: "file", bytes: Buffer.from(b64, "base64") };
      } catch {
        return undefined;
      }
    };
    // 把 b64 表塞到指定 turn map（先到先得,后续 snapshot 不覆盖已有 rel）。
    const applyB64Map = (
      map: Map<string, BaselineEntry>,
      table: Record<string, string | null>,
    ) => {
      for (const [rel, b64] of Object.entries(table)) {
        const key = rel.replace(/\\/g, "/");
        if (map.has(key)) continue;
        const e = decodeFileEntry(b64);
        if (e) map.set(key, e);
      }
    };

    for (const entry of sm.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== FILE_BASELINE_CUSTOM_TYPE) continue;
      const data = entry.data as
        | BaselinePersistPayload
        | { paths?: Record<string, string | null> }
        | undefined;
      if (!data || typeof data !== "object") continue;

      // B9: 增量删除 —— 旧快照中的已删 turn 不得复活（先删后合）。
      const dropped = (data as BaselinePersistPayload).droppedTurns;
      if (Array.isArray(dropped)) {
        for (const uid of dropped) this.turnBaselines.delete(uid);
      }

      if ("turns" in data && data.turns && typeof data.turns === "object") {
        // New format: per-turn
        for (const [uid, paths] of Object.entries(data.turns)) {
          applyB64Map(ensureTurnMap(uid), paths);
        }
        // Symlink 表（与 turns 互斥）
        const symlinks = (data as BaselinePersistPayload).symlinks;
        if (symlinks && typeof symlinks === "object") {
          for (const [uid, links] of Object.entries(symlinks)) {
            const map = ensureTurnMap(uid);
            for (const [rel, target] of Object.entries(links)) {
              const key = rel.replace(/\\/g, "/");
              if (map.has(key) || typeof target !== "string") continue;
              map.set(key, { kind: "symlink", target });
            }
          }
        }
        continue;
      }

      // Legacy flat format → attach under synthetic turn id
      const legacy = (data as { paths?: Record<string, string | null> }).paths;
      if (legacy && typeof legacy === "object") {
        applyB64Map(ensureTurnMap("_legacy"), legacy);
      }
    }
    this.dirty = false;
  }
}

export function pathFromArgsForTest(args: unknown): string | null {
  return pathFromToolArgs(args);
}
