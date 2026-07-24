/**
 * Multi-agent Fleet foundation: registry of named session slots.
 */

import type { FleetSlotInfo as IpcFleetSlotInfo } from "../../shared/ipc";

export type FleetSlotId = string;

/** Registry slot metadata; `busy` is computed by FleetHostManager for IPC. */
export type FleetSlotInfo = Omit<IpcFleetSlotInfo, "busy">;

export class FleetRegistry {
  private slots = new Map<FleetSlotId, FleetSlotInfo>();
  private activeId: FleetSlotId | null = null;

  list(): FleetSlotInfo[] {
    return [...this.slots.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  getActiveId(): FleetSlotId | null {
    return this.activeId;
  }

  get(id: FleetSlotId): FleetSlotInfo | undefined {
    return this.slots.get(id);
  }

  create(input: {
    id?: string;
    label: string;
    role?: FleetSlotInfo["role"];
    cwd?: string | null;
  }): FleetSlotInfo {
    const id =
      input.id ??
      `fleet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const slot: FleetSlotInfo = {
      id,
      label: input.label,
      cwd: input.cwd ?? null,
      sessionId: null,
      role: input.role ?? "worker",
      createdAt: new Date().toISOString(),
    };
    this.slots.set(id, slot);
    if (!this.activeId) this.activeId = id;
    return slot;
  }

  setActive(id: FleetSlotId): boolean {
    if (!this.slots.has(id)) return false;
    this.activeId = id;
    return true;
  }

  update(
    id: FleetSlotId,
    patch: Partial<Pick<FleetSlotInfo, "label" | "cwd" | "sessionId" | "role">>,
  ): FleetSlotInfo | null {
    const cur = this.slots.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.slots.set(id, next);
    return next;
  }

  remove(id: FleetSlotId): boolean {
    const ok = this.slots.delete(id);
    if (this.activeId === id) {
      this.activeId = this.slots.keys().next().value ?? null;
    }
    return ok;
  }
}
