/**
 * History / usage / compaction event emission (issue #59 主题 A 提取).
 *
 * Lifted out of SessionHost so the host facade stays focused on
 * "接 Pi 事件 + 路由到子编排器". These are small state-emission
 * helpers that share deps; they can live here as free functions and
 * be unit-tested without standing up the full SessionHost.
 */
import { branchEntriesToHistory } from "../../shared/transcript";
import {
  buildUsageSnapshot as buildUsageSnapshotFor,
  captureCompactionBaseline as captureCompactionBaselineFor,
  recordCompactionDelta as recordCompactionDeltaFor,
} from "./session-usage";
import { emptyUsageSnapshot } from "./session-host-helpers";
import type { HistoryItem, SessionUsageSnapshot, UiAgentEvent } from "../../shared/ipc";
import type { SessionBundle } from "./session-lifecycle";
import type { TurnUsage } from "../../shared/ipc";
import type { ToolDetailRecord } from "./session-host-helpers";

/** Snapshot deps for history / usage / compaction emission. */
export interface HistoryEmitDeps {
  getBundle(): SessionBundle | null;
  getLastTurnUsage(): TurnUsage | undefined;
  getLastHistoryFingerprint(): string | null;
  setLastHistoryFingerprint(fp: string | null): void;
  toolDetails: Map<string, ToolDetailRecord>;
  /** Compaction baseline (mutable, session-host-owned). */
  getCompactionStatsBaseline(): unknown;
  setCompactionStatsBaseline(baseline: unknown): void;
  getCompactionRecording(): boolean;
  setCompactionRecording(v: boolean): void;
  emit(event: UiAgentEvent): void;
}

/** Build the current usage snapshot, or null if no bundle. */
export function buildUsageSnapshot(deps: HistoryEmitDeps): SessionUsageSnapshot | null {
  const bundle = deps.getBundle();
  if (!bundle) return null;
  return buildUsageSnapshotFor(bundle.session, deps.getLastTurnUsage());
}

/** Build the session branch as a HistoryItem list. */
export function historyFromBundle(deps: HistoryEmitDeps): HistoryItem[] {
  const bundle = deps.getBundle();
  if (!bundle) return [];
  try {
    const branch = bundle.session.sessionManager.getBranch();
    return branchEntriesToHistory(branch);
  } catch {
    return [];
  }
}

/** Stable fingerprint of a history item list (for change detection). */
export function historyFingerprint(items: HistoryItem[]): string {
  return items
    .map((item) => {
      switch (item.kind) {
        case "user":
          return `u:${item.id}:${item.entryId ?? ""}:${item.text.length}`;
        case "assistant":
          return `a:${item.id}:${item.entryId ?? ""}:${item.userEntryId ?? ""}:${item.text.length}:${item.thinking.length}:${item.done ? 1 : 0}`;
        case "tool": {
          const resultLen =
            typeof item.result === "string"
              ? item.result.length
              : item.result == null
                ? 0
                : 1;
          return `t:${item.id}:${item.toolName}:${resultLen}:${item.done ? 1 : 0}`;
        }
        case "system":
          return `s:${item.id}:${item.text.length}`;
        default:
          return `?:${(item as { id?: string }).id ?? ""}`;
      }
    })
    .join("|");
}

/** Emit a history_replace event, deduplicating by fingerprint. */
export function emitHistoryReplace(deps: HistoryEmitDeps): void {
  const items = historyFromBundle(deps);
  const fingerprint = historyFingerprint(items);
  if (fingerprint === deps.getLastHistoryFingerprint()) return;
  deps.setLastHistoryFingerprint(fingerprint);
  deps.emit({ type: "history_replace", items });
}

/** Emit a usage_update event from the current snapshot. */
export function emitUsageUpdate(deps: HistoryEmitDeps): void {
  if (!deps.getBundle()) return;
  const usage = buildUsageSnapshot(deps) ?? emptyUsageSnapshot();
  deps.emit({ type: "usage_update", usage });
}

/** Snapshot compaction baseline (called at compaction_start). */
export function captureCompactionBaseline(deps: HistoryEmitDeps): void {
  const bundle = deps.getBundle();
  deps.setCompactionStatsBaseline(
    bundle ? captureCompactionBaselineFor(bundle.session) : null,
  );
}

/** Persist compaction delta to daily store (called at compaction_end). */
export function recordCompactionDelta(deps: HistoryEmitDeps): void {
  const baseline = deps.getCompactionStatsBaseline();
  deps.setCompactionStatsBaseline(null);
  const bundle = deps.getBundle();
  if (!baseline || !bundle) return;
  // baseline is the same type returned by captureCompactionBaselineFor; cast
  // through unknown to satisfy strict signatures without depending on the
  // exact import here.
  recordCompactionDeltaFor(
    bundle.session,
    baseline as Parameters<typeof recordCompactionDeltaFor>[1],
  );
}

/**
 * Prune toolDetails to only those referenced by the current branch's
 * assistant messages.  Called after retract / session switch to drop
 * dangling tool IDs.
 */
export function pruneToolDetailsToBranch(deps: HistoryEmitDeps): void {
  const bundle = deps.getBundle();
  if (!bundle) {
    deps.toolDetails.clear();
    return;
  }
  const keep = new Set<string>();
  try {
    for (const entry of bundle.session.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message as {
        role?: string;
        content?: Array<{ type?: string; id?: string }>;
      };
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (part.type === "toolCall" && part.id) keep.add(part.id);
      }
    }
  } catch {
    return;
  }
  for (const id of deps.toolDetails.keys()) {
    if (!keep.has(id)) deps.toolDetails.delete(id);
  }
}
