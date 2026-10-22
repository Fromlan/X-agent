/**
 * Session maintenance: compact / reload resources / auto-maintain
 * (issue #59 主题 A 提取).
 *
 * Lifted out of SessionHost so the host facade stays focused on
 * "接 Pi 事件 + 路由到子编排器". These are discrete maintenance
 * operations with their own state guards; they can live here as
 * free functions and be unit-tested.
 */
import { dbgWarn } from "../../shared/debug-log";
import { getCachedPrefs } from "./prefs";
import { autoMaintain } from "./auto-maintain";
import type { SessionBundle } from "./session-lifecycle";
import type { NoticeReplaceKey } from "../../shared/ipc";
import { buildCompactionInstructions } from "../../shared/agent-instructions";

/** Snapshot deps for maintenance operations. */
export interface MaintenanceDeps {
  getBundle(): SessionBundle | null;
  /** 当前 host status (用于 compact 时拒绝 streaming / retrying). */
  getStatus(): "idle" | "streaming" | "retrying" | "error";
  /** Fresh prompt checkpoint preparation is busy even before Pi starts streaming. */
  isPromptPreparing(): boolean;
  /** Include the settlement guard so frontend compact cannot queue a duplicate pass. */
  isMaintaining(): boolean;
  setMaintaining(active: boolean): void;
  /** 互斥运行同一 host 上的 replace 操作. */
  runReplaceExclusive<T>(fn: () => Promise<T>): Promise<T>;
  /** 默认资源加载器 (用于 reload). */
  getResourceLoader(): { reload(): Promise<void> } | null;
  /** 通知 sessionMode 重新 apply Plan/Goal append. */
  refreshAfterResourceReload(): void;
  emitUsageUpdate(): void;
  emitReplaceableNotice(
    replaceKey: NoticeReplaceKey,
    text: string,
    level?: "info" | "warn" | "error",
  ): void;
}

/** Reserve and serialize one summary against sends, settlement and session replacement. */
export async function compactSession(
  deps: MaintenanceDeps,
  customInstructions?: string,
): Promise<{ ok: boolean; error?: string; tokensBefore?: number; estimatedTokensAfter?: number }> {
  // Reject before enqueuing: an auto-compact requested from stale frontend
  // pressure must not execute a second summary after maintenance releases.
  if (deps.isMaintaining()) return { ok: false, error: "会话正在维护中" };
  const requestedBundle = deps.getBundle();
  if (!requestedBundle) return { ok: false, error: "尚未打开项目" };
  // Reserve before the promise queue yields so two same-tick compact requests
  // cannot both enqueue, and prompt cannot overtake a queued compact.
  deps.setMaintaining(true);
  try {
    return await deps.runReplaceExclusive(async () => {
      const bundle = deps.getBundle();
      if (!bundle) {
        return { ok: false, error: "尚未打开项目" };
      }
      if (bundle !== requestedBundle) return { ok: false, error: "会话已切换" };
      if (deps.isPromptPreparing() || bundle.session.isStreaming || deps.getStatus() === "retrying") {
        return { ok: false, error: "请等待当前回合结束后再压缩" };
      }
      const session = bundle.session;
      if (session.isCompacting) {
        return { ok: false, error: "正在压缩中" };
      }
      try {
        const result = await session.compact(
          buildCompactionInstructions(customInstructions),
        );
        if (deps.getBundle() === bundle) {
          deps.emitUsageUpdate();
        }
        return {
          ok: true,
          tokensBefore: result.tokensBefore,
          estimatedTokensAfter: result.estimatedTokensAfter,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  } finally {
    deps.setMaintaining(false);
  }
}

export async function reloadResources(
  deps: MaintenanceDeps,
): Promise<{ ok: boolean; reloaded: boolean; error?: string }> {
  const bundle = deps.getBundle();
  if (!bundle) {
    return { ok: true, reloaded: false };
  }
  try {
    await bundle.session.reload();
    // Pi's reload may refresh the tool registry / loader append; re-apply mode
    // system append + active tools so Plan/Goal instructions stay attached.
    const loader = deps.getResourceLoader();
    if (loader) {
      await loader.reload();
    }
    deps.refreshAfterResourceReload();
    deps.emitReplaceableNotice(
      "resources",
      "已重载 prompts / skills / extensions",
    );
    deps.emitUsageUpdate();
    return { ok: true, reloaded: true };
  } catch (err) {
    return {
      ok: false,
      reloaded: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Maintain the settled session under the same replacement lock as manual
 * compaction. UI remains busy until the caller has received fresh usage.
 */
export async function autoMaintainIfNeeded(deps: MaintenanceDeps): Promise<void> {
  const bundle = deps.getBundle();
  if (!bundle) return;
  await deps.runReplaceExclusive(async () => {
    if (deps.getBundle() !== bundle || deps.isPromptPreparing() || bundle.session.isStreaming || bundle.session.isCompacting) return;
    deps.setMaintaining(true);
    try {
      const prefs = getCachedPrefs();
      const report = await autoMaintain(bundle.session, prefs, {
        log: (line) => dbgWarn("auto-maintain", line),
      });
      if (deps.getBundle() !== bundle) return;
      if (report.outcome === "compacted" || report.outcome === "snipped-and-compacted") {
        deps.emitReplaceableNotice(
          "auto-maintain",
          `已自动压缩上下文（释放约 ${report.compactFreedTokens ?? "?"} tokens）`,
          "info",
        );
      } else if (report.outcome === "snip-cleared") {
        deps.emitReplaceableNotice(
          "auto-maintain",
          `已裁剪 ${report.snip.snippedCount} 个过大的工具结果，压缩暂不需要`,
          "info",
        );
      } else if (report.outcome === "compact-failed") {
        deps.emitReplaceableNotice(
          "auto-maintain",
          `自动压缩失败：${report.detail ?? "未知原因"}`,
          "warn",
        );
      }
      if (report.outcome !== "below-threshold" && report.outcome !== "disabled" && report.outcome !== "debounced") {
        deps.emitUsageUpdate();
      }
    } finally {
      deps.setMaintaining(false);
    }
  });
}
