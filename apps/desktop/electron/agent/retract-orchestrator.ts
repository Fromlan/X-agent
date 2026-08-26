/**
 * 撤回撤销 pipeline: abort → scan → navigate → restore → prune.
 * Trackers stay deep leaves; this module owns ordering + warning merge.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  AgentStatus,
  RetractOptions,
  RetractPreview,
  RetractResult,
} from "../../shared/ipc";
import { extractMessageText } from "../../shared/transcript";
import type { TurnFileTracker } from "./turn-file-tracker";
import type { ShadowCheckpointTracker } from "./shadow-checkpoints";
import { CompositeRestoreSource } from "./restore-source";

export type RetractSessionBundle = {
  session: AgentSession;
};

export type RetractOrchestratorHost = {
  getBundle(): RetractSessionBundle | null;
  fileTracker: TurnFileTracker;
  shadowCheckpoints: ShadowCheckpointTracker;
  setStatus(status: AgentStatus, error?: string): void;
  pruneToolDetailsToBranch(): void;
  emitHistoryReplace(): void;
  emitUsageUpdate(): void;
  prompt(text: string): Promise<{ ok: boolean; error?: string }>;
  /** True while prompt() is between checkpoint prepare and session.prompt. */
  isPromptPreparing?(): boolean;
  /** Called after successful navigate + restore so Goal budget can roll back. */
  onRetractSuccess?(abandonedUserEntryIds: readonly string[]): void;
};

export type ResolvedUserEntry =
  | { ok: true; entryId: string; editorText: string }
  | { ok: false; error: string };

export function resolveUserEntryId(
  bundle: RetractSessionBundle | null,
  entryId: string,
): ResolvedUserEntry {
  if (!bundle) return { ok: false, error: "尚未打开项目" };
  const sm = bundle.session.sessionManager;
  const entry = sm.getEntry(entryId);
  if (!entry) return { ok: false, error: "找不到该消息" };
  if (entry.type !== "message") {
    return { ok: false, error: "只能从用户消息撤回" };
  }
  const msg = (entry as { message?: { role?: string; content?: unknown } })
    .message;
  if (!msg || msg.role !== "user") {
    return { ok: false, error: "只能从用户消息撤回" };
  }
  const editorText = extractMessageText(msg);
  if (!editorText) return { ok: false, error: "用户消息为空" };
  return { ok: true, entryId, editorText };
}

export class RetractOrchestrator {
  constructor(private readonly getHost: () => RetractOrchestratorHost) {}

  private host(): RetractOrchestratorHost {
    return this.getHost();
  }

  resolveUserEntryId(entryId: string): ResolvedUserEntry {
    return resolveUserEntryId(this.host().getBundle(), entryId);
  }

  async preview(entryId: string): Promise<RetractPreview> {
    const h = this.host();
    const resolved = this.resolveUserEntryId(entryId);
    if (!resolved.ok) {
      return {
        ok: false,
        error: resolved.error,
        restorablePaths: [],
        unrestorablePaths: [],
        hasBash: false,
        hasGodot: false,
        warnings: [],
        restoreMode: "none",
        shadowAvailable: h.shadowCheckpoints.enabledShadow,
      };
    }
    const sm = h.getBundle()!.session.sessionManager;
    const sources = new CompositeRestoreSource([h.shadowCheckpoints, h.fileTracker]);
    const scan = sources.scan(sm, resolved.entryId);
    const preview = await sources.preview(sm, resolved.entryId, scan);

    if (preview.mode === "shadow") {
      return {
        ok: true,
        editorText: resolved.editorText,
        restorablePaths: preview.restorablePaths,
        unrestorablePaths: [],
        hasBash: preview.hasBash,
        hasGodot: preview.hasGodot,
        warnings: preview.warnings,
        restoreMode: "shadow",
        shadowAvailable: true,
        ...(preview.diffText !== undefined ? { diffText: preview.diffText } : {}),
        ...(preview.diffTruncated !== undefined
          ? { diffTruncated: preview.diffTruncated }
          : {}),
      };
    }

    return {
      ok: true,
      editorText: resolved.editorText,
      restorablePaths: preview.restorablePaths,
      unrestorablePaths: preview.unrestorablePaths,
      hasBash: preview.hasBash,
      hasGodot: preview.hasGodot,
      warnings: preview.warnings,
      restoreMode: preview.mode === "none" ? "none" : "baseline",
      shadowAvailable: h.shadowCheckpoints.enabledShadow,
      ...(preview.diffText !== undefined ? { diffText: preview.diffText } : {}),
      ...(preview.diffTruncated !== undefined
        ? { diffTruncated: preview.diffTruncated }
        : {}),
    };
  }

  /**
   * 关键时序：
   *   1. abort 当前流（若有）。
   *   2. 只读 scan 即将废弃的 segment（不写盘）；navigate 取消时无需回滚。
   *   3. navigateTree；若 cancelled 则直接返回。
   *   4. navigate 成功后优先 Shadow checkout；否则按预扫路径 restorePaths。
   *   5. dropBaselines · persistDirty · 清空 activeUserEntryId · history replace。
   */
  async retract(
    entryId: string,
    options?: RetractOptions,
  ): Promise<RetractResult> {
    const h = this.host();
    if (!h.getBundle()) return { ok: false, error: "尚未打开项目" };
    // 竞态硬闸：prompt 正处于 prepare→session.prompt 过渡窗口时拒绝撤回。
    // （该窗口内 isStreaming 仍为 false，abort 会空转，navigateTree 会与新
    //   一轮 prompt 交错；pendingPreSha 也可能被错绑。）
    if (h.isPromptPreparing?.()) {
      return { ok: false, error: "消息发送中，请稍后再试" };
    }
    const resolved = this.resolveUserEntryId(entryId);
    if (!resolved.ok) return { ok: false, error: resolved.error };

    const undoFiles = options?.undoFiles !== false;
    const { session } = h.getBundle()!;
    const sm = session.sessionManager;

    try {
      if (session.isStreaming) {
        await session.abort();
        h.setStatus("idle");
      }

      // 预扫必须在 navigate 之前：nav 后 abandoned write/edit 不在 active branch。
      // 这是撤回撤销的硬时序,集中在 CompositeRestoreSource.scan 一处文档化.
      // Goal budget rollback also needs abandoned user entry ids from this scan.
      const sources = new CompositeRestoreSource([h.shadowCheckpoints, h.fileTracker]);
      const pendingScan = sources.scan(sm, resolved.entryId);

      const nav = await session.navigateTree(resolved.entryId, {
        summarize: false,
      });
      if (nav.cancelled) {
        return { ok: false, error: "撤回已取消" };
      }

      let restoreReport: RetractResult["restoreReport"];
      if (undoFiles) {
        const attempt = await sources.restore(sm, resolved.entryId, pendingScan);
        restoreReport = attempt.report;
        h.fileTracker.dropBaselinesForTurns(pendingScan.userEntryIds);
        h.fileTracker.persistDirty(sm);
      } else {
        // B10: 不做磁盘还原，但仍清理基线 / 检查点元数据并持久化，
        // 避免被废弃 turn 的字节快照随后续 turn_end 反复全量落盘。
        h.fileTracker.dropBaselinesForTurns(pendingScan.userEntryIds);
        h.fileTracker.persistDirty(sm);
        h.shadowCheckpoints.pruneAbandonedTurns(
          resolved.entryId,
          pendingScan.userEntryIds,
        );
        h.shadowCheckpoints.persistDirty(sm);
      }

      // 撤回后旧 leaf 不再属于 active branch；下一次 user_message 事件再赋新 id。
      // 同时丢弃未绑定的 pending pre SHA，避免旧 pre 复活到新 turn。
      h.fileTracker.setActiveUserEntryId(null);
      h.shadowCheckpoints.discardPendingPre();
      h.pruneToolDetailsToBranch();
      h.emitHistoryReplace();
      h.emitUsageUpdate();
      h.setStatus("idle");
      h.onRetractSuccess?.(pendingScan.userEntryIds);

      return {
        ok: true,
        editorText: nav.editorText ?? resolved.editorText,
        restoreReport,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      h.setStatus("error", message);
      return { ok: false, error: message };
    }
  }

  async editAndResend(
    entryId: string,
    text: string,
    options?: RetractOptions,
  ): Promise<RetractResult> {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "消息不能为空" };

    const retract = await this.retract(entryId, options);
    if (!retract.ok) return retract;

    const prompted = await this.host().prompt(trimmed);
    if (!prompted.ok) {
      return {
        ok: false,
        error: prompted.error,
        editorText: retract.editorText,
        restoreReport: retract.restoreReport,
      };
    }
    return retract;
  }

  async regenerate(
    entryId: string,
    options?: RetractOptions,
  ): Promise<RetractResult> {
    const resolved = this.resolveUserEntryId(entryId);
    if (!resolved.ok) return { ok: false, error: resolved.error };

    const retract = await this.retract(entryId, options);
    if (!retract.ok) return retract;

    const text = (retract.editorText ?? resolved.editorText).trim();
    if (!text) return { ok: false, error: "用户消息为空" };

    const prompted = await this.host().prompt(text);
    if (!prompted.ok) {
      return {
        ok: false,
        error: prompted.error,
        editorText: text,
        restoreReport: retract.restoreReport,
      };
    }
    return { ...retract, editorText: text };
  }
}
