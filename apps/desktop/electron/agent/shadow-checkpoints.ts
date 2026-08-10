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
  /** B9: 增量持久化 —— 自上次 append 以来被删除（撤回）的 turn 列表。 */
  droppedTurns?: string[];
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
  /** B9: 自上次持久化以来变更的 turn（增量 append，避免全量快照膨胀）。 */
  private dirtyTurns = new Set<string>();
  /** B9: 自上次持久化以来被删除（撤回）的 turn。 */
  private droppedTurns = new Set<string>();
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
    this.dirtyTurns.clear();
    this.droppedTurns.clear();
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
    this.dirtyTurns.add(userEntryId);
    this.droppedTurns.delete(userEntryId);
  }

  /**
   * 撤回 / 分支切换后丢弃未绑定的 pending pre SHA。
   * 否则「撤回恰落在 prepare 与 prompt 之间」的旧 pre 会被下一次 bind 复活，
   * 再撤回新 turn 时会 reset 回被撤回的旧状态。
   */
  discardPendingPre(): void {
    this.pendingPreSha = null;
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
      this.dirtyTurns.add(userEntryId);
      this.droppedTurns.delete(userEntryId);
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

  /** B9: 增量持久化 —— 只 append 自上次以来的变更，避免全量快照 O(N²) 膨胀。 */
  persistDirty(sm: SessionManagerLike): void {
    if (!this.dirty) return;
    const turns: Record<string, TurnCheckpoint> = {};
    for (const uid of this.dirtyTurns) {
      const cp = this.turns.get(uid);
      if (!cp) continue;
      turns[uid] = { ...cp };
    }
    try {
      const payload: ShadowCheckpointPersistPayload = { turns };
      if (this.droppedTurns.size > 0) {
        payload.droppedTurns = [...this.droppedTurns];
      }
      sm.appendCustomEntry(SHADOW_CHECKPOINT_CUSTOM_TYPE, payload);
      this.dirty = false;
      this.dirtyTurns.clear();
      this.droppedTurns.clear();
    } catch {
      /* non-fatal; dirty flags stay set so the next turn retries */
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
      // B9: 增量删除 —— 旧快照中的已删 turn 不得复活（先删后合）。
      if (Array.isArray(data.droppedTurns)) {
        for (const uid of data.droppedTurns) {
          this.turns.delete(uid);
        }
      }
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
   * 计算某回合 pre→post 的统一 diff（post 缺失时对 worktree），
   * 供 turn_end 后聊天流展示"本轮改了什么"。无 Git / 无 pre 检查点返回 null。
   */
  async diffForTurn(
    userEntryId: string,
  ): Promise<
    | { diffText: string; paths: string[]; truncated?: boolean }
    | null
  > {
    if (!(await this.ensureReady()) || !this.shadow) return null;
    await this.flush();
    const cp = this.turns.get(userEntryId);
    if (!cp?.pre) return null;
    const to = cp.post ?? (await this.shadow.revParse("HEAD"));
    const text = await this.shadow.diffText(cp.pre, to ?? undefined);
    if (!text.ok || !text.text) return null;
    const paths = await this.shadow.diffPaths(cp.pre, to ?? undefined);
    return {
      diffText: text.text,
      paths: paths.ok ? paths.paths : [],
      ...(text.truncated ? { truncated: true } : {}),
    };
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
      | "diffText"
      | "diffTruncated"
    > & { mode: "shadow" | "baseline" | "none"; shadowSha?: string }
  > {
    await this.flush();
    const warnings: string[] = [];
    const sha = this.resolveRestoreSha(sm, targetUserEntryId);

    if (this.enabled && this.shadow && sha) {
      const head = await this.shadow.revParse("HEAD");
      const diff = await this.shadow.diffPathsIncludingWorktree(sha, head);
      const paths = diff.ok ? diff.paths : segmentScan.mutationPaths;
      // 撤回预览 diff：pre→HEAD 的统一 diff（head 缺失时对 worktree）。
      // 与还原范围（target→HEAD diff 路径集）保持一致，让用户看清将被还原的内容。
      let diffText: string | undefined;
      let diffTruncated: boolean | undefined;
      if (diff.ok && paths.length > 0) {
        const text = await this.shadow.diffText(sha, head ?? undefined);
        if (text.ok && text.text) {
          diffText = text.text;
          diffTruncated = text.truncated;
        }
      }
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
      warnings.push(
        "只还原该回合内变化过的文件；你的手动编辑若与 Agent 改动同一路径也会被还原。",
      );
      return {
        mode: "shadow",
        shadowSha: sha,
        restorablePaths: paths,
        unrestorablePaths: [],
        hasBash: segmentScan.hasBash,
        hasGodot: segmentScan.hasGodot,
        warnings,
        ...(diffText !== undefined ? { diffText } : {}),
        ...(diffTruncated !== undefined ? { diffTruncated } : {}),
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

  /**
   * B10: 撤回后清理被废弃 turn 的检查点元数据（不碰磁盘 / shadow 工作树）。
   * 目标 turn 保留 pre（后续仍可再撤回）；其余废弃 turn 的检查点删除。
   */
  pruneAbandonedTurns(
    targetUserEntryId: string,
    abandonedUserEntryIds: string[],
  ): void {
    for (const id of abandonedUserEntryIds) {
      if (id === targetUserEntryId) {
        const cp = this.turns.get(id);
        if (cp?.pre) {
          this.turns.set(id, { pre: cp.pre });
          this.dirtyTurns.add(id);
          this.droppedTurns.delete(id);
        } else {
          this.turns.delete(id);
          this.droppedTurns.add(id);
          this.dirtyTurns.delete(id);
        }
        continue;
      }
      this.turns.delete(id);
      this.droppedTurns.add(id);
      this.dirtyTurns.delete(id);
    }
    this.dirty = true;
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
    // 只还原「该回合内变化过的路径」（target→HEAD 的 diff 路径集），
    // 不再整库 reset --hard：用户回合期间未动过的文件（含回合后的手动编辑）
    // 原样保留。diff 计算失败时回退全量还原（旧行为）。
    let restorePaths: string[] | undefined;
    const head = await this.shadow.revParse("HEAD");
    if (head) {
      const diff = await this.shadow.diffPaths(sha, head);
      if (diff.ok && diff.paths.length > 0) restorePaths = diff.paths;
    }
    const result = await this.shadow.restore(
      sha,
      restorePaths ? { paths: restorePaths } : undefined,
    );
    if (!result.ok) {
      return {
        used: "none",
        report: toReport(result),
      };
    }
    this.pruneAbandonedTurns(targetUserEntryId, abandonedUserEntryIds);
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
