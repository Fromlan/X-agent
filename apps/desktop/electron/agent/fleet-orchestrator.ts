/**
 * Fleet codegen-review pair: Wave1 parallel worker+reviewer, Wave2 handoff.
 */

import type { FleetPairState, FleetUiEvent } from "../../shared/ipc";
import { buildPairHandoff } from "./fleet-handoff";
import {
  reviewerWave1Prompt,
  reviewerWave2Prompt,
  workerWave1Prompt,
} from "./fleet-pair-prompts";
import type { SessionHost } from "./session-host";

export type FleetPairHostAccess = {
  getPrimaryCwd: () => string | null;
  ensureRoleSlot: (
    role: "worker" | "reviewer",
    label: string,
  ) => Promise<{ id: string; host: SessionHost }>;
  emitFleet: (event: FleetUiEvent) => void;
};

const IDLE_PAIR: FleetPairState = { phase: "idle" };

function isActivePhase(phase: FleetPairState["phase"]): boolean {
  return phase === "wave1" || phase === "wave2";
}

function isHostBusy(host: SessionHost): boolean {
  const s = host.getStatus().status;
  return s === "streaming" || s === "retrying";
}

export class FleetOrchestrator {
  private pair: FleetPairState = { ...IDLE_PAIR };
  private unsubWorker: (() => void) | null = null;
  private unsubReviewer: (() => void) | null = null;
  private wave2Started = false;
  /** Bumped on abort so in-flight Wave2 exits cleanly. */
  private runGeneration = 0;

  constructor(private readonly access: FleetPairHostAccess) {}

  getPairState(): FleetPairState {
    return { ...this.pair };
  }

  private setPair(next: FleetPairState): void {
    this.pair = { ...next };
    this.access.emitFleet({ type: "pair_progress", pair: this.getPairState() });
  }

  private clearLifecycleSubs(): void {
    if (this.unsubWorker) {
      this.unsubWorker();
      this.unsubWorker = null;
    }
    if (this.unsubReviewer) {
      this.unsubReviewer();
      this.unsubReviewer = null;
    }
  }

  async startPair(
    task: string,
  ): Promise<{ ok: boolean; error?: string; pair?: FleetPairState }> {
    const trimmed = task.trim();
    if (!trimmed) {
      return { ok: false, error: "任务不能为空" };
    }
    if (isActivePhase(this.pair.phase)) {
      return { ok: false, error: "已有进行中的并行编排，请先中止或等待结束" };
    }

    const cwd = this.access.getPrimaryCwd();
    if (!cwd) {
      return { ok: false, error: "请先在主会话打开项目" };
    }

    // Claim the active phase before any await so concurrent startPair calls refuse.
    this.clearLifecycleSubs();
    this.wave2Started = false;
    const generation = ++this.runGeneration;
    this.setPair({
      phase: "wave1",
      task: trimmed,
      message: "Wave1：准备槽位…",
    });

    let worker: { id: string; host: SessionHost };
    let reviewer: { id: string; host: SessionHost };
    try {
      [worker, reviewer] = await Promise.all([
        this.access.ensureRoleSlot("worker", "实现"),
        this.access.ensureRoleSlot("reviewer", "审阅"),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setPair({
        phase: "error",
        task: trimmed,
        message: `创建槽位失败: ${message}`,
      });
      return { ok: false, error: message, pair: this.getPairState() };
    }

    if (generation !== this.runGeneration) {
      return { ok: false, error: "编排已中止", pair: this.getPairState() };
    }

    if (isHostBusy(worker.host) || isHostBusy(reviewer.host)) {
      const message = "实现或审阅槽仍在运行中，请先等待或中止后再开编排";
      this.setPair({
        phase: "error",
        task: trimmed,
        workerSlotId: worker.id,
        reviewerSlotId: reviewer.id,
        message,
      });
      return { ok: false, error: message, pair: this.getPairState() };
    }

    this.setPair({
      phase: "wave1",
      task: trimmed,
      workerSlotId: worker.id,
      reviewerSlotId: reviewer.id,
      message: "Wave1：实现与审阅并行",
    });

    this.unsubWorker = worker.host.onLifecycle((event) => {
      if (event.type !== "agent_end" || event.willRetry) return;
      if (this.pair.phase !== "wave1") return;
      if (this.wave2Started) return;
      this.wave2Started = true;
      void this.runWave2(trimmed, cwd, worker.host, reviewer.host, generation);
    });

    // Must not await session.prompt() — it resolves only when the full turn ends,
    // which freezes the IPC caller and UI busy flag for minutes.
    const wRes = worker.host.beginPrompt(workerWave1Prompt(trimmed));
    const rRes = reviewer.host.beginPrompt(reviewerWave1Prompt(trimmed));

    if (!wRes.ok && !rRes.ok) {
      this.clearLifecycleSubs();
      const message = wRes.error ?? rRes.error ?? "Wave1 启动失败";
      this.setPair({
        phase: "error",
        task: trimmed,
        workerSlotId: worker.id,
        reviewerSlotId: reviewer.id,
        message,
      });
      return { ok: false, error: message, pair: this.getPairState() };
    }

    if (!wRes.ok) {
      this.clearLifecycleSubs();
      const message = `实现槽启动失败: ${wRes.error ?? "未知错误"}`;
      this.setPair({
        phase: "error",
        task: trimmed,
        workerSlotId: worker.id,
        reviewerSlotId: reviewer.id,
        message,
      });
      return { ok: false, error: message, pair: this.getPairState() };
    }

    if (!rRes.ok) {
      this.setPair({
        ...this.getPairState(),
        message: `Wave1：实现已启动；审阅启动失败（${rRes.error ?? "未知"}），仍将在实现结束后尝试 Wave2`,
      });
    }

    return { ok: true, pair: this.getPairState() };
  }

  private async runWave2(
    task: string,
    cwd: string,
    worker: SessionHost,
    reviewer: SessionHost,
    generation: number,
  ): Promise<void> {
    if (generation !== this.runGeneration) return;

    this.setPair({
      phase: "wave2",
      task,
      workerSlotId: this.pair.workerSlotId,
      reviewerSlotId: this.pair.reviewerSlotId,
      message: "Wave2：基于变更做具体审阅",
    });

    let handoff: string;
    try {
      handoff = await buildPairHandoff(cwd, () =>
        worker.getRecentTextExcerpt(4000),
      );
    } catch (err) {
      handoff =
        worker.getRecentTextExcerpt(4000) ||
        `（handoff 构建失败: ${err instanceof Error ? err.message : String(err)}）`;
    }

    if (generation !== this.runGeneration) return;

    // Non-blocking: Wave2 prompt may run a long time; stay in wave2 until reviewer ends.
    const result = reviewer.beginPrompt(reviewerWave2Prompt(task, handoff));
    this.clearLifecycleSubs();

    if (generation !== this.runGeneration) return;

    if (!result.ok) {
      this.setPair({
        phase: "error",
        task,
        workerSlotId: this.pair.workerSlotId,
        reviewerSlotId: this.pair.reviewerSlotId,
        message: `Wave2 启动失败: ${result.error ?? "未知错误"}`,
      });
      return;
    }

    this.setPair({
      phase: "wave2",
      task,
      workerSlotId: this.pair.workerSlotId,
      reviewerSlotId: this.pair.reviewerSlotId,
      message: "Wave2：审阅进行中",
    });

    this.unsubReviewer = reviewer.onLifecycle((event) => {
      if (event.type !== "agent_end" || event.willRetry) return;
      if (generation !== this.runGeneration) return;
      if (this.pair.phase !== "wave2") return;
      this.clearLifecycleSubs();
      this.setPair({
        phase: "done",
        task,
        workerSlotId: this.pair.workerSlotId,
        reviewerSlotId: this.pair.reviewerSlotId,
        message: "编排完成（审阅 Wave2 已结束）",
      });
    });
  }

  async abortPair(): Promise<{
    ok: boolean;
    error?: string;
    pair?: FleetPairState;
  }> {
    if (!isActivePhase(this.pair.phase)) {
      return { ok: false, error: "当前没有进行中的并行编排", pair: this.getPairState() };
    }

    const workerId = this.pair.workerSlotId;
    const reviewerId = this.pair.reviewerSlotId;
    this.clearLifecycleSubs();
    this.wave2Started = true;
    this.runGeneration += 1;

    this.setPair({
      phase: "aborted",
      task: this.pair.task,
      workerSlotId: workerId,
      reviewerSlotId: reviewerId,
      message: "已中止并行编排",
    });

    return { ok: true, pair: this.getPairState() };
  }

  /**
   * Abort underlying hosts for the current/last pair slots (called by manager).
   */
  async abortPairHosts(
    getHost: (id: string) => SessionHost | undefined,
  ): Promise<void> {
    const ids = [this.pair.workerSlotId, this.pair.reviewerSlotId].filter(
      (id): id is string => Boolean(id),
    );
    await Promise.all(
      ids.map(async (id) => {
        const host = getHost(id);
        if (host) await host.abort();
      }),
    );
  }
}
