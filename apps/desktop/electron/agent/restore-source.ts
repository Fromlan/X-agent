/**
 * 撤回撤销还原接缝：ShadowCheckpointTracker 与 TurnFileTracker 是两个真实
 * 还原适配器（git 检查点 vs write/edit 字节基线）。本模块定义它们共享的
 * RestoreSource 接口 + CompositeRestoreSource 调度器 —— 编排器只面对一个接缝，
 * 新增还原源 = 实现接口并加入数组，不再改编排器。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { FileRestoreReport } from "../../shared/ipc";

/** Minimal session-manager surface both restore sources need. */
export type RestoreSessionManager = {
  getBranch: (fromId?: string) => Array<{
    type: string;
    id: string;
    message?: { role?: string; content?: unknown; toolName?: string };
    customType?: string;
    data?: unknown;
  }>;
  getEntries: () => Array<{
    type: string;
    id: string;
    customType?: string;
    data?: unknown;
  }>;
  getEntry: (id: string) => { type: string; id: string } | undefined;
  appendCustomEntry: (customType: string, data?: unknown) => string;
};

export type RestoreSegmentScan = {
  mutationPaths: string[];
  userEntryIds: string[];
  hasBash: boolean;
  hasGodot: boolean;
};

export type RestorePreview = {
  mode: "shadow" | "baseline" | "none";
  restorablePaths: string[];
  unrestorablePaths: string[];
  hasBash: boolean;
  hasGodot: boolean;
  warnings: string[];
  /** Unified diff of restorable paths (shadow mode only, optional). */
  diffText?: string;
  /** True when diffText was truncated to the payload cap. */
  diffTruncated?: boolean;
};

export type RestoreAttempt = {
  used: "shadow" | "baseline" | "none";
  report?: FileRestoreReport;
};

/**
 * A single restore source behind the seam. `preview` answers "can you restore
 * this segment?"; `restore` performs it and reports what happened. A source
 * only "owns" a segment when its preview/attempt mode equals its `kind`
 * (e.g. shadow saying "baseline" means "not me — keep going").
 */
export interface RestoreSource {
  /** The mode this source can produce. */
  readonly kind: "shadow" | "baseline";
  /** Human-readable name for fallback warnings. */
  readonly label: string;
  /** Warning shown when this source failed and the next one takes over. */
  readonly fallbackWarning: string;
  preview(
    sm: RestoreSessionManager,
    targetUserEntryId: string,
    scan: RestoreSegmentScan,
  ): Promise<RestorePreview>;
  restore(
    sm: RestoreSessionManager,
    targetUserEntryId: string,
    scan: RestoreSegmentScan,
  ): Promise<RestoreAttempt>;
}

/** Merge warnings from lower-priority sources into the winner's list (dedup, keep order). */
function mergeWarnings(carried: string[], next: string[]): string[] {
  const seen = new Set(carried);
  const merged = [...carried];
  for (const w of next) {
    if (!seen.has(w)) {
      seen.add(w);
      merged.push(w);
    }
  }
  return merged;
}

/**
 * Priority-ordered restore scheduler: asks sources in order and uses the first
 * one that can handle the segment; on restore failure it falls back to the next
 * source and records the reason. Bash / Godot unrecoverability is appended to
 * the final report here so all callers see the same warnings.
 */
export class CompositeRestoreSource {
  constructor(private readonly sources: readonly RestoreSource[]) {}

  async preview(
    sm: RestoreSessionManager,
    targetUserEntryId: string,
    scan: RestoreSegmentScan,
  ): Promise<RestorePreview> {
    let carried: string[] = [];
    for (const source of this.sources) {
      const result = await source.preview(sm, targetUserEntryId, scan);
      if (result.mode === source.kind) {
        return { ...result, warnings: mergeWarnings(carried, result.warnings) };
      }
      carried = mergeWarnings(carried, result.warnings);
    }
    return {
      mode: "none",
      restorablePaths: [],
      unrestorablePaths: [],
      hasBash: scan.hasBash,
      hasGodot: scan.hasGodot,
      warnings: carried,
    };
  }

  async restore(
    sm: RestoreSessionManager,
    targetUserEntryId: string,
    scan: RestoreSegmentScan,
  ): Promise<RestoreAttempt> {
    for (let i = 0; i < this.sources.length; i++) {
      const source = this.sources[i]!;
      const attempt = await source.restore(sm, targetUserEntryId, scan);
      if (attempt.used === source.kind) {
        return { used: attempt.used, report: this.enrich(attempt.report, attempt.used, scan) };
      }
      if (attempt.report && i + 1 < this.sources.length) {
        const next = await this.sources[i + 1]!.restore(sm, targetUserEntryId, scan);
        if (next.report && attempt.report.warnings.length > 0) {
          next.report.warnings = [
            source.fallbackWarning,
            ...attempt.report.warnings,
            ...next.report.warnings,
          ];
        }
        return { used: next.used, report: this.enrich(next.report, next.used, scan) };
      }
    }
    return { used: "none" };
  }

  /** Append bash / Godot unrecoverability facts the way each mode documents them. */
  private enrich(
    report: FileRestoreReport | undefined,
    used: RestoreAttempt["used"],
    scan: RestoreSegmentScan,
  ): FileRestoreReport | undefined {
    if (!report) return report;
    // 1.3 防御：返回新报告对象，避免在复合 fallback 路径里多次 push 同一个
    // 引用造成重复 warning / skipped。
    const skipped = [...report.skipped];
    const warnings = [...report.warnings];
    if (scan.hasGodot) {
      skipped.push({ reason: "godot" });
      warnings.push(
        "该段包含会改编辑器状态的 Godot 工具，编辑器内存态无法还原。",
      );
    }
    if (scan.hasBash) {
      if (used === "shadow") {
        warnings.push(
          "该段包含 bash：cwd 内文件已尽量由 Shadow 还原；cwd 外副作用无法还原。",
        );
      } else {
        skipped.push({ reason: "bash_unknown" });
        warnings.push("该段包含 bash，命令副作用无法保证还原。");
      }
    }
    return { ...report, skipped, warnings };
  }
}

/** Type helper for sources that operate on a real Pi session. */
export type RestoreSessionBundle = { session: AgentSession };
