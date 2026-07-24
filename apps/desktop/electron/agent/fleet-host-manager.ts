/**
 * Multi-SessionHost Fleet: one live host per registry slot, shared Godot RPC.
 */

import type { BrowserWindow } from "electron";
import type { FleetSlotInfo, FleetState } from "../../shared/ipc";
import { FleetRegistry, type FleetSlotId } from "./fleet-registry";
import type { GodotRpcBridge } from "./godot-rpc-bridge";
import { SessionHost } from "./session-host";

export type { FleetState };

export class FleetHostManager {
  private readonly registry = new FleetRegistry();
  private readonly hosts = new Map<FleetSlotId, SessionHost>();
  private readonly getWindow: () => BrowserWindow | null;
  private readonly godotRpc: GodotRpcBridge | null;

  constructor(
    getWindow: () => BrowserWindow | null,
    godotRpc: GodotRpcBridge | null = null,
  ) {
    this.getWindow = getWindow;
    this.godotRpc = godotRpc;
    this.bootPrimary();
  }

  private bootPrimary(): void {
    const slot = this.registry.create({
      id: "primary",
      label: "主会话",
      role: "primary",
    });
    this.attachHost(slot.id);
  }

  private attachHost(slotId: FleetSlotId): SessionHost {
    const host = new SessionHost(this.getWindow, this.godotRpc);
    host.setEmitEnabled(() => this.registry.getActiveId() === slotId);
    this.hosts.set(slotId, host);
    return host;
  }

  private syncSlotFromHost(slotId: FleetSlotId): void {
    const host = this.hosts.get(slotId);
    if (!host) return;
    const status = host.getStatus();
    this.registry.update(slotId, {
      cwd: status.cwd,
      sessionId: status.sessionId,
    });
  }

  getActiveHost(): SessionHost {
    const id = this.registry.getActiveId();
    if (!id) {
      throw new Error("Fleet 没有活动槽位");
    }
    const host = this.hosts.get(id);
    if (!host) {
      throw new Error(`Fleet 槽位缺少 SessionHost: ${id}`);
    }
    return host;
  }

  getActiveId(): FleetSlotId | null {
    return this.registry.getActiveId();
  }

  list(): FleetSlotInfo[] {
    for (const id of this.hosts.keys()) {
      this.syncSlotFromHost(id);
    }
    return this.registry.list();
  }

  state(): FleetState {
    return {
      slots: this.list(),
      activeId: this.registry.getActiveId(),
    };
  }

  async createSlot(
    label: string,
    role?: FleetSlotInfo["role"],
  ): Promise<FleetSlotInfo> {
    const primary = this.hosts.get("primary");
    const primaryCwd = primary?.getStatus().cwd ?? null;
    const slot = this.registry.create({
      label: label.trim() || "工作区",
      role: role ?? "worker",
      cwd: primaryCwd,
    });
    const host = this.attachHost(slot.id);

    if (primaryCwd) {
      try {
        const result = await host.openProject(primaryCwd, "new");
        if (result.ok) {
          this.registry.update(slot.id, {
            cwd: result.cwd,
            sessionId: result.sessionId,
          });
        }
      } catch {
        // Host remains empty; slot still usable after manual openProject.
      }
    }

    return this.registry.get(slot.id) ?? slot;
  }

  async setActive(id: FleetSlotId): Promise<{ ok: boolean; error?: string }> {
    if (!this.registry.get(id) || !this.hosts.has(id)) {
      return { ok: false, error: "槽位不存在" };
    }
    if (!this.registry.setActive(id)) {
      return { ok: false, error: "无法切换槽位" };
    }
    this.syncSlotFromHost(id);
    this.hosts.get(id)?.resyncUi();
    return { ok: true };
  }

  async removeSlot(
    id: FleetSlotId,
  ): Promise<{ ok: boolean; error?: string }> {
    if (id === "primary") {
      return { ok: false, error: "不能移除主会话" };
    }
    if (this.registry.list().length <= 1) {
      return { ok: false, error: "至少保留一个会话槽" };
    }
    if (!this.registry.get(id)) {
      return { ok: false, error: "槽位不存在" };
    }

    const wasActive = this.registry.getActiveId() === id;
    const host = this.hosts.get(id);
    if (host) {
      await host.dispose();
      this.hosts.delete(id);
    }
    this.registry.remove(id);

    if (wasActive) {
      const nextId = this.registry.getActiveId();
      if (nextId) {
        this.syncSlotFromHost(nextId);
        this.hosts.get(nextId)?.resyncUi();
      }
    }
    return { ok: true };
  }

  async dispose(): Promise<void> {
    const hosts = [...this.hosts.values()];
    this.hosts.clear();
    await Promise.all(hosts.map((h) => h.dispose()));
  }
}
