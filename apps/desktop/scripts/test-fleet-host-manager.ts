import { FleetHostManager } from "../electron/agent/fleet-host-manager";
import { SessionHost } from "../electron/agent/session-host";
import type { UiAgentEvent } from "../shared/ipc";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function isActive(host: SessionHost): boolean {
  return (host as unknown as { isActiveSlot: () => boolean }).isActiveSlot();
}

function hostMap(fleet: FleetHostManager): Map<string, SessionHost> {
  return (fleet as unknown as { hosts: Map<string, SessionHost> }).hosts;
}

function captureSink(host: SessionHost): UiAgentEvent[] {
  const events: UiAgentEvent[] = [];
  const prev = (host as unknown as {
    eventSink: ((e: UiAgentEvent) => void) | null;
  }).eventSink;
  host.setEventSink((e) => {
    events.push(e);
    prev?.(e);
  });
  return events;
}

async function main(): Promise<void> {
  const fleet = new FleetHostManager(() => null, null);
  const state0 = fleet.state();
  assert(state0.slots.length === 1, "boots with primary");
  assert(state0.activeId === "primary", "primary active");
  assert(state0.pair.phase === "idle", "pair starts idle");
  assert(state0.slots[0]!.busy === false, "primary not busy");
  assert(state0.slots[0]!.label === "主会话", "chinese primary label");
  assert(fleet.getActiveHost() instanceof SessionHost, "active host exists");

  const worker = await fleet.createSlot("工作区 1", "worker");
  assert(fleet.list().length === 2, "two slots after create");
  assert(worker.role === "worker", "worker role");
  assert(worker.busy === false, "worker not busy");
  assert(fleet.getActiveId() === "primary", "create does not steal active");

  const reviewer = await fleet.createSlot("审阅", "reviewer");
  assert(reviewer.role === "reviewer", "reviewer role");
  assert(fleet.list().length === 3, "three slots");

  const hosts = hostMap(fleet);
  const primaryHost = hosts.get("primary")!;
  const workerHost = hosts.get(worker.id)!;
  assert(isActive(primaryHost), "primary active check while active");
  assert(!isActive(workerHost), "worker inactive check");

  const workerEvents = captureSink(workerHost);
  // Inactive slots still stream via sink (history_replace for isolation).
  workerHost.resyncUi();
  assert(
    workerEvents.some((e) => e.type === "history_replace"),
    "inactive worker still emits history_replace via sink",
  );

  primaryHost.resyncUi();
  assert(Array.isArray(primaryHost.getHistorySnapshot()), "history snapshot");

  const switched = await fleet.setActive(worker.id);
  assert(switched.ok, "setActive worker");
  assert(fleet.getActiveId() === worker.id, "active is worker");
  assert(!isActive(primaryHost), "primary inactive after switch");
  assert(isActive(workerHost), "worker active after switch");
  workerHost.resyncUi();

  const refusePrimary = await fleet.removeSlot("primary");
  assert(!refusePrimary.ok, "refuse remove primary");

  await fleet.setActive("primary");
  const removedReviewer = await fleet.removeSlot(reviewer.id);
  assert(removedReviewer.ok, "remove reviewer");
  const removed = await fleet.removeSlot(worker.id);
  assert(removed.ok, "remove worker");
  assert(fleet.list().length === 1, "one slot left");

  const refuseLast = await fleet.removeSlot("primary");
  assert(!refuseLast.ok, "refuse remove last");

  const noPair = await fleet.startPair("task");
  assert(!noPair.ok, "pair needs primary cwd");

  await fleet.dispose();
  console.log("test-fleet-host-manager: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
