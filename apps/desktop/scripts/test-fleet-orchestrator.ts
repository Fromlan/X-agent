/**
 * Offline tests for Fleet pair prompts + handoff helpers + orchestrator flow.
 */

import { truncateHandoff } from "../electron/agent/fleet-handoff";
import {
  reviewerWave1Prompt,
  reviewerWave2Prompt,
  workerWave1Prompt,
} from "../electron/agent/fleet-pair-prompts";
import { FleetOrchestrator } from "../electron/agent/fleet-orchestrator";
import type { AgentStatus } from "../shared/ipc";
import type { SessionHost } from "../electron/agent/session-host";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- prompts ---
const task = "给 Player 加冲刺";
const w1 = workerWave1Prompt(task);
assert(w1.includes("实现槽"), "worker wave1 role");
assert(w1.includes(task), "worker wave1 task");
const r1 = reviewerWave1Prompt(task);
assert(r1.includes("审阅槽"), "reviewer wave1 role");
assert(r1.includes("不要大改"), "reviewer wave1 no big edits");
const r2 = reviewerWave2Prompt(task, "### git diff\n+sprint");
assert(r2.includes("Wave2"), "reviewer wave2");
assert(r2.includes("+sprint"), "reviewer wave2 handoff");

assert(truncateHandoff("abc") === "abc", "no truncate short");
const long = "x".repeat(9000);
assert(truncateHandoff(long, 100).includes("已截断"), "truncate long");

// --- mock host ---
type LifeEv = { type: "agent_start" | "agent_end"; willRetry?: boolean };

function createMockHost(id: string, initialStatus: AgentStatus = "idle") {
  const prompts: string[] = [];
  const life = new Set<(e: LifeEv) => void>();
  let status: AgentStatus = initialStatus;
  const host = {
    id,
    prompts,
    beginPrompt(text: string) {
      prompts.push(text);
      status = "streaming";
      for (const fn of life) fn({ type: "agent_start" });
      return { ok: true as const };
    },
    async prompt(text: string) {
      return host.beginPrompt(text);
    },
    async abort() {
      status = "idle";
      return { ok: true as const };
    },
    getStatus() {
      return {
        status,
        cwd: "D:/proj",
        sessionId: "s",
        sessionPath: null,
        model: null,
        thinkingLevel: "medium" as const,
        hasSession: true,
      };
    },
    setStatus(next: AgentStatus) {
      status = next;
    },
    getRecentTextExcerpt() {
      return "【助理】\ndone sprint";
    },
    onLifecycle(fn: (e: LifeEv) => void) {
      life.add(fn);
      return () => {
        life.delete(fn);
      };
    },
    /** Simulate agent finishing. */
    finish(willRetry = false) {
      status = willRetry ? "retrying" : "idle";
      for (const fn of life) fn({ type: "agent_end", willRetry });
    },
  };
  return host;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function testOrchestrator(): Promise<void> {
  const worker = createMockHost("worker-1");
  const reviewer = createMockHost("reviewer-1");
  const events: string[] = [];

  const orch = new FleetOrchestrator({
    getPrimaryCwd: () => "D:/proj",
    ensureRoleSlot: async (role) => {
      if (role === "worker") {
        return { id: worker.id, host: worker as unknown as SessionHost };
      }
      return { id: reviewer.id, host: reviewer as unknown as SessionHost };
    },
    emitFleet: (event) => {
      if (event.type === "pair_progress") {
        events.push(event.pair.phase);
      }
    },
  });

  assert(orch.getPairState().phase === "idle", "starts idle");

  const noCwd = new FleetOrchestrator({
    getPrimaryCwd: () => null,
    ensureRoleSlot: async () => {
      throw new Error("should not create");
    },
    emitFleet: () => undefined,
  });
  const refused = await noCwd.startPair("x");
  assert(!refused.ok, "refuse without cwd");

  const started = await orch.startPair(task);
  assert(started.ok, "start pair ok");
  assert(orch.getPairState().phase === "wave1", "phase wave1");
  assert(worker.prompts.length === 1, "worker prompted once");
  assert(reviewer.prompts.length === 1, "reviewer prompted once");
  assert(worker.prompts[0]!.includes("实现槽"), "worker got wave1 prompt");
  assert(reviewer.prompts[0]!.includes("审阅槽"), "reviewer got wave1 prompt");

  const busyAgain = await orch.startPair("another");
  assert(!busyAgain.ok, "reject second pair");

  worker.finish(false);
  await wait(50);
  assert(orch.getPairState().phase === "wave2", `expected wave2 after worker end, got ${orch.getPairState().phase}`);
  assert(reviewer.prompts.length >= 2, "reviewer got wave2 prompt");
  assert(reviewer.prompts[1]!.includes("Wave2"), "second prompt is wave2");
  // Prompt success must NOT flip to done yet
  assert(orch.getPairState().phase !== "done", "not done until reviewer finishes");
  assert(orch.getPairState().message?.includes("进行中"), "wave2 in-progress message");

  reviewer.finish(false);
  await wait(20);
  assert(orch.getPairState().phase === "done", `expected done after reviewer end, got ${orch.getPairState().phase}`);
  assert(events.includes("wave1") && events.includes("wave2") && events.includes("done"), "progress events");

  // Abort path on fresh orch
  const worker2 = createMockHost("w2");
  const reviewer2 = createMockHost("r2");
  const orch2 = new FleetOrchestrator({
    getPrimaryCwd: () => "D:/proj",
    ensureRoleSlot: async (role) =>
      role === "worker"
        ? { id: worker2.id, host: worker2 as unknown as SessionHost }
        : { id: reviewer2.id, host: reviewer2 as unknown as SessionHost },
    emitFleet: () => undefined,
  });
  await orch2.startPair("abort me");
  const aborted = await orch2.abortPair();
  assert(aborted.ok, "abort ok");
  assert(orch2.getPairState().phase === "aborted", "aborted phase");
  worker2.finish(false);
  await wait(30);
  assert(reviewer2.prompts.length === 1, "no wave2 after abort");

  // Concurrent startPair: second call must refuse while first is ensuring slots
  let releaseEnsure!: () => void;
  const ensureGate = new Promise<void>((resolve) => {
    releaseEnsure = resolve;
  });
  let ensureCalls = 0;
  const worker3 = createMockHost("w3");
  const reviewer3 = createMockHost("r3");
  const orch3 = new FleetOrchestrator({
    getPrimaryCwd: () => "D:/proj",
    ensureRoleSlot: async (role) => {
      ensureCalls += 1;
      await ensureGate;
      return role === "worker"
        ? { id: worker3.id, host: worker3 as unknown as SessionHost }
        : { id: reviewer3.id, host: reviewer3 as unknown as SessionHost };
    },
    emitFleet: () => undefined,
  });
  const p1 = orch3.startPair("first");
  await wait(10);
  assert(orch3.getPairState().phase === "wave1", "claimed wave1 before ensure");
  const p2 = orch3.startPair("second");
  const second = await p2;
  assert(!second.ok, "concurrent start refused");
  releaseEnsure();
  const first = await p1;
  assert(first.ok, "first start ok after ensure");
  assert(ensureCalls === 2, "first start ensured both roles once each");

  // Busy host rejection
  const worker4 = createMockHost("w4", "streaming");
  const reviewer4 = createMockHost("r4");
  const orch4 = new FleetOrchestrator({
    getPrimaryCwd: () => "D:/proj",
    ensureRoleSlot: async (role) =>
      role === "worker"
        ? { id: worker4.id, host: worker4 as unknown as SessionHost }
        : { id: reviewer4.id, host: reviewer4 as unknown as SessionHost },
    emitFleet: () => undefined,
  });
  const busyStart = await orch4.startPair("busy");
  assert(!busyStart.ok, "refuse when worker already streaming");
  assert(orch4.getPairState().phase === "error", "busy → error phase");
  assert(worker4.prompts.length === 0, "no prompt when busy");
}

testOrchestrator()
  .then(() => {
    console.log("test-fleet-orchestrator: ok");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
