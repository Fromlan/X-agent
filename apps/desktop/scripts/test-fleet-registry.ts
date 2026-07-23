import { FleetRegistry } from "../electron/agent/fleet-registry";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const fleet = new FleetRegistry();
const primary = fleet.create({ id: "primary", label: "Primary", role: "primary" });
assert(fleet.getActiveId() === "primary", "active defaults to first");
const worker = fleet.create({ label: "Worker A", role: "worker" });
assert(fleet.list().length === 2, "two slots");
assert(fleet.setActive(worker.id), "set active worker");
assert(fleet.getActiveId() === worker.id, "active is worker");
fleet.update(worker.id, { sessionId: "sess-1", cwd: "D:/proj" });
assert(fleet.get(worker.id)?.sessionId === "sess-1", "patch session");
assert(fleet.remove(worker.id), "remove worker");
assert(fleet.getActiveId() === primary.id, "fallback active");
assert(fleet.list().length === 1, "one left");

console.log("test-fleet-registry: ok");
