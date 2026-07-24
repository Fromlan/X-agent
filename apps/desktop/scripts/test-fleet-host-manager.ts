import { FleetHostManager } from "../electron/agent/fleet-host-manager";
import { SessionHost } from "../electron/agent/session-host";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function emitAllowed(host: SessionHost): boolean {
  return (host as unknown as { emitEnabled: () => boolean }).emitEnabled();
}

function hostMap(fleet: FleetHostManager): Map<string, SessionHost> {
  return (fleet as unknown as { hosts: Map<string, SessionHost> }).hosts;
}

async function main(): Promise<void> {
  const fleet = new FleetHostManager(() => null, null);
  const state0 = fleet.state();
  assert(state0.slots.length === 1, "boots with primary");
  assert(state0.activeId === "primary", "primary active");
  assert(state0.slots[0]!.label === "主会话", "chinese primary label");
  assert(fleet.getActiveHost() instanceof SessionHost, "active host exists");

  const worker = await fleet.createSlot("工作区 1", "worker");
  assert(fleet.list().length === 2, "two slots after create");
  assert(worker.role === "worker", "worker role");
  assert(fleet.getActiveId() === "primary", "create does not steal active");

  const hosts = hostMap(fleet);
  const primaryHost = hosts.get("primary")!;
  const workerHost = hosts.get(worker.id)!;
  assert(emitAllowed(primaryHost), "primary emit enabled while active");
  assert(!emitAllowed(workerHost), "worker emit gated while inactive");

  // resyncUi must not throw with null BrowserWindow
  primaryHost.resyncUi();
  assert(Array.isArray(primaryHost.getHistorySnapshot()), "history snapshot");

  const switched = await fleet.setActive(worker.id);
  assert(switched.ok, "setActive worker");
  assert(fleet.getActiveId() === worker.id, "active is worker");
  assert(!emitAllowed(primaryHost), "primary gated after switch");
  assert(emitAllowed(workerHost), "worker emit enabled after switch");
  workerHost.resyncUi();

  const refusePrimary = await fleet.removeSlot("primary");
  assert(!refusePrimary.ok, "refuse remove primary");

  await fleet.setActive("primary");
  const removed = await fleet.removeSlot(worker.id);
  assert(removed.ok, "remove worker");
  assert(fleet.list().length === 1, "one slot left");

  const refuseLast = await fleet.removeSlot("primary");
  assert(!refuseLast.ok, "refuse remove last");

  await fleet.dispose();
  console.log("test-fleet-host-manager: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
