/**
 * Per-session shadow checkpoint map: userEntryId → { pre, post } SHAs.
 * Persisted via SessionManager custom entries; restore orchestrates ShadowGit.
 */
import type { FileRestoreReport, RetractPreview } from "../../shared/ipc";
import { ShadowGit, type ShadowRestoreResult } from "./shadow-git";
import { isGitAvailable } from "./git-exec";
import type {
  RestoreAttempt,
  RestorePreview,
  RestoreSegmentScan,
  RestoreSessionManager,
  RestoreSource,
} from "./restore-source";

export const SHADOW_CHECKPOINT_CUSTOM_TYPE = "x-agent-shadow-checkpoints";

export type TurnCheckpoint = {
  pre?: string;
  post?: string;
};

export type ShadowCheckpointPersistPayload = {
  turns: Record<string, TurnCheckpoint>;
};

type SessionManagerLike = RestoreSessionManager;

function toReport(r: ShadowRestoreResult): FileRestoreReport {
  return {
    restored: r.restored,
    deleted: r.deleted,
    skipped: r.skipped.map((s) => ({
      path: s.path,
      reason: (s.reason === "outside_cwd"
        ? "outside_cwd"
        : "error") as FileRestoreReport["skipped"][number]["reason"],
      detail: s.detail,
    })),
    warnings: [...r.warnings, ...(r.error ? [r.error] : [])],
  };
}

export class ShadowCheckpointTracker implements RestoreSource {
  readonly kind = "shadow" as const;
  readonly label = "Shadow 检查点";
  readonly fallbackWarning = "Shadow 检查点还原失败，已降级为 write/edit 基线。";
  private shadow: ShadowGit | null = null;
  private turns = new Map<string, TurnCheckpoint>();
  private dirty = false;
  private enabled = false;
  private initPromise: Promise<boolean> | null = null;
  /** Serialize commits so pre/post ordering stays consistent. */
  private chain: Promise<void> = Promise.resolve();
  /** SHA captured immediately before prompt(); bound to userEntryId on message_start. */
  private pendingPreSha: string | null = null;
  /** Bumped on clear/setCwd so in-flight enqueued ops become no-ops. */
  private epoch = 0;

  get enabledShadow(): boolean {
    return this.enabled;
  }

  getUnavailableReason(): string | null {
    return this.shadow?.getUnavailableReason() ?? null;
  }

  clear(): void {
    this.epoch += 1;
    this.turns.clear();
    this.dirty = false;
    this.shadow = null;
    this.enabled = false;
    this.initPromise = null;
    this.pendingPreSha = null;
    // Drop the queue: subsequent enqueue starts fresh after this epoch bump.
    this.chain = Promise.resolve();
  }

  async setCwd(cwd: string): Promise<boolean> {
    this.clear();
    if (!(await isGitAvailable())) {
      this.enabled = false;
      return false;
    }
    const epoch = this.epoch;
    this.shadow = new ShadowGit(cwd);
    this.initPromise = this.shadow.ensureRepo().then((r) => {
      if (epoch !== this.epoch) return false;
      this.enabled = r.ok;
      return r.ok;
    });
    return this.initPromise;
  }

  private async ensureReady(): Promise<boolean> {
    if (this.initPromise) await this.initPromise;
    return this.enabled && Boolean(this.shadow);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T | undefined> {
    const epoch = this.epoch;
    const run = this.chain.then(async () => {
      if (epoch !== this.epoch) return undefined;
      return fn();
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  getCheckpoint(userEntryId: string): TurnCheckpoint | undefined {
    return this.turns.get(userEntryId);
  }

  /**
   * Snapshot workspace before session.prompt() so tools cannot race past pre.
   * Call only when not mid-stream (steer keeps the existing turn pre).
   */
  async preparePromptCheckpoint(): Promise<void> {
    await this.enqueue(async () => {
      const epoch = this.epoch;
      if (!(await this.ensureReady()) || !this.shadow) return;
      if (epoch !== this.epoch) return;
      const result = await this.shadow.commit("pending-pre");
      if (epoch !== this.epoch) return;
      if (result.ok) this.pendingPreSha = result.sha;
    });
  }

  /** Attach pending pre SHA to the user entry that just started. */
  bindPendingPre(userEntryId: string): void {
    const existing = this.turns.get(userEntryId);
    if (existing?.pre) {
      this.pendingPreSha = null;
      return;
    }
    if (!this.pendingPreSha) return;
    const cur = existing ?? {};
    cur.pre = this.pendingPreSha;
    this.turns.set(userEntryId, cur);
    this.pendingPreSha = null;
    this.dirty = true;
  }

  /** Capture post-turn workspace state (updates each turn_end). */
  async capturePost(userEntryId: string): Promise<void> {
    await this.enqueue(async () => {
      const epoch = this.epoch;
      if (!(await this.ensureReady()) || !this.shadow) return;
      if (epoch !== this.epoch) return;
      const result = await this.shadow.commit(`post:${userEntryId}`);
      if (epoch !== this.epoch) return;
      if (!result.ok) return;
      const cur = this.turns.get(userEntryId) ?? {};
      cur.post = result.sha;
      // Do NOT invent pre=post: that would make retract a no-op when prepare/bind failed.
      this.turns.set(userEntryId, cur);
      this.dirty = true;
    });
  }

  /**
   * Wait for outstanding shadow commits (e.g. before retract/preview) so
   * post SHAs and worktree HEAD are settled.
   */
  async flush(): Promise<void> {
    const epoch = this.epoch;
    await this.chain;
    if (epoch !== this.epoch) return;
  }

  persistDirty(sm: SessionManagerLike): void {
    if (!this.dirty) return;
    const turns: Record<string, TurnCheckpoint> = {};
    for (const [uid, cp] of this.turns) {
      turns[uid] = { ...cp };
    }
    try {
      sm.appendCustomEntry(SHADOW_CHECKPOINT_CUSTOM_TYPE, {
        turns,
      } satisfies ShadowCheckpointPersistPayload);
      this.dirty = false;
    } catch {
      /* non-fatal */
    }
  }

  loadFromSession(sm: SessionManagerLike): void {
    for (const entry of sm.getEntries()) {
      if (
        entry.type !== "custom" ||
        entry.customType !== SHADOW_CHECKPOINT_CUSTOM_TYPE
      ) {
        continue;
      }
      const data = entry.data as ShadowCheckpointPersistPayload | undefined;
      if (!data?.turns || typeof data.turns !== "object") continue;
      for (const [uid, cp] of Object.entries(data.turns)) {
        if (!cp || typeof cp !== "object") continue;
        const prev = this.turns.get(uid) ?? {};
        if (typeof cp.pre === "string" && !prev.pre) prev.pre = cp.pre;
        if (typeof cp.post === "string") prev.post = cp.post;
        this.turns.set(uid, prev);
      }
    }
    this.dirty = false;
  }

  /**
   * Resolve pre SHA for retract target: the target user turn's pre,
   * else previous sibling turn's post on the branch.
   */
  resolveRestoreSha(
    sm: SessionManagerLike,
    targetUserEntryId: string,
  ): string | null {
    const direct = this.turns.get(targetUserEntryId)?.pre;
    if (direct) return direct;

    const branch = sm.getBranch();
    const idx = branch.findIndex((e) => e.id === targetUserEntryId);
    if (idx < 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
      const e = branch[i];
      if (e.type !== "message" || e.message?.role !== "user") continue;
      const cp = this.turns.get(e.id);
      if (cp?.post) return cp.post;
      if (cp?.pre) return cp.pre;
    }
    return null;
  }

  async previewRestore(
    sm: SessionManagerLike,
    targetUserEntryId: string,
    segmentScan: {
      mutationPaths: string[];
      hasBash: boolean;
      hasGodot: boolean;
    },
  ): Promise<
    Pick<
      RetractPreview,
      | "restorablePaths"
      | "unrestorablePaths"
      | "hasBash"
      | "hasGodot"
      | "warnings"
    > & { mode: "shadow" | "baseline" | "none"; shadowSha?: string }
  > {
    await this.flush();
    const warnings: string[] = [];
    const sha = this.resolveRestoreSha(sm, targetUserEntryId);

    if (this.enabled && this.shadow && sha) {
      const head = await this.shadow.revParse("HEAD");
      const diff = await this.shadow.diffPathsIncludingWorktree(sha, head);
      const paths = diff.ok ? diff.paths : segmentScan.mutationPaths;
      if (segmentScan.hasGodot) {
        warnings.push(
          "该段包含会改编辑器状态的 Godot 工具，编辑器内存态无法还原。",
        );
      }
      if (segmentScan.hasBash) {
        warnings.push(
          "该段包含 bash：cwd 内文件改动可由 Shadow 检查点还原；cwd 外副作用仍无法还原。",
        );
      }
      return {
        mode: "shadow",
        shadowSha: sha,
        restorablePaths: paths,
        unrestorablePaths: [],
        hasBash: segmentScan.hasBash,
        hasGodot: segmentScan.hasGodot,
        warnings,
      };
    }

    if (!this.enabled) {
      warnings.push(
        "未安装 Git 或 Shadow 检查点不可用，将仅还原 write/edit 文件基线（bash 改盘无法保证）。",
      );
    } else if (!sha) {
      warnings.push("缺少 Shadow 检查点，将尝试 write/edit 文件基线还原。");
    }

    return {
      mode: "baseline",
      restorablePaths: [],
      unrestorablePaths: [],
      hasBash: segmentScan.hasBash,
      hasGodot: segmentScan.hasGodot,
      warnings,
    };
  }

  async restoreToUserTurn(
    sm: SessionManagerLike,
    targetUserEntryId: string,
    abandonedUserEntryIds: string[],
  ): Promise<{
    used: "shadow" | "none";
    report?: FileRestoreReport;
  }> {
    await this.flush();
    const sha = this.resolveRestoreSha(sm, targetUserEntryId);
    if (!(await this.ensureReady()) || !this.shadow || !sha) {
      return { used: "none" };
    }
    const result = await this.shadow.restore(sha);
    if (!result.ok) {
      return {
        used: "none",
        report: toReport(result),
      };
    }
    for (const id of abandonedUserEntryIds) {
      if (id === targetUserEntryId) {
        const cp = this.turns.get(id);
        if (cp?.pre) this.turns.set(id, { pre: cp.pre });
        else this.turns.delete(id);
        continue;
      }
      this.turns.delete(id);
    }
    this.dirty = true;
    this.persistDirty(sm);
    return { used: "shadow", report: toReport(result) };
  }

  /** RestoreSource seam: preview — same logic as previewRestore. */
  async preview(
    sm: RestoreSessionManager,
    targetUserEntryId: string,
    scan: RestoreSegmentScan,
  ): Promise<RestorePreview> {
    return this.previewRestore(sm, targetUserEntryId, scan);
  }

  /** RestoreSource seam: restore — same logic as restoreToUserTurn. */
  async restore(
    sm: RestoreSessionManager,
    targetUserEntryId: string,
    scan: RestoreSegmentScan,
  ): Promise<RestoreAttempt> {
    return this.restoreToUserTurn(sm, targetUserEntryId, scan.userEntryIds);
  }
}
