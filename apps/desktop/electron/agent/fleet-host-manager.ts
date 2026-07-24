/**
 * Multi-SessionHost Fleet: one live host per registry slot, shared Godot RPC.
 * Owns codegen-review pair orchestration.
 */

import type { BrowserWindow } from "electron";
import type {
  FleetPairState,
  FleetSlotInfo,
  FleetState,
  FleetUiEvent,
} from "../../shared/ipc";
import { FleetOrchestrator } from "./fleet-orchestrator";
import { FleetRegistry, type FleetSlotId } from "./fleet-registry";
import type { GodotRpcBridge } from "./godot-rpc-bridge";
import { SessionHost } from "./session-host";

export type { FleetState };

function hostBusy(host: SessionHost | undefined): boolean {
  if (!host) return false;
  const s = host.getStatus().status;
  return s === "streaming" || s === "retrying";
}

export class FleetHostManager {
  private readonly registry = new FleetRegistry();
  private readonly hosts = new Map<FleetSlotId, SessionHost>();
  private readonly hostUnsubs = new Map<FleetSlotId, () => void>();
  private readonly getWindow: () => BrowserWindow | null;
  private readonly godotRpc: GodotRpcBridge | null;
  private readonly orchestrator: FleetOrchestrator;

  constructor(
    getWindow: () => BrowserWindow | null,
    godotRpc: GodotRpcBridge | null = null,
  ) {
    this.getWindow = getWindow;
    this.godotRpc = godotRpc;
    this.orchestrator = new FleetOrchestrator({
      getPrimaryCwd: () => this.hosts.get("primary")?.getStatus().cwd ?? null,
      ensureRoleSlot: (role, label) => this.ensureRoleSlot(role, label),
      emitFleet: (event) => this.emitFleet(event),
    });
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

  private emitFleet(event: FleetUiEvent): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("fleet:event", event);
    }
  }

  private pushSlotStatus(slotId: FleetSlotId): void {
    const host = this.hosts.get(slotId);
    if (!host) return;
    const status = host.getStatus().status;
    this.emitFleet({
      type: "slot_status",
      slotId,
      busy: status === "streaming" || status === "retrying",
      status,
    });
  }

  private attachHost(slotId: FleetSlotId): SessionHost {
    const host = new SessionHost(this.getWindow, this.godotRpc);
    host.setActiveSlotCheck(() => this.registry.getActiveId() === slotId);
    host.setEventSink((event) => {
      const win = this.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("agent:event", { slotId, event });
      }
    });
    const unsub = host.onStatusChange(() => {
      this.pushSlotStatus(slotId);
    });
    this.hostUnsubs.set(slotId, unsub);
    this.hosts.set(slotId, host);
    return host;
  }

  private detachHost(slotId: FleetSlotId): SessionHost | undefined {
    this.hostUnsubs.get(slotId)?.();
    this.hostUnsubs.delete(slotId);
    const host = this.hosts.get(slotId);
    this.hosts.delete(slotId);
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

  private toSlotInfo(slot: {
    id: string;
    label: string;
    cwd: string | null;
    sessionId: string | null;
    role: FleetSlotInfo["role"];
    createdAt: string;
  }): FleetSlotInfo {
    return {
      ...slot,
      busy: hostBusy(this.hosts.get(slot.id)),
    };
  }

  getHost(id: FleetSlotId): SessionHost | undefined {
    return this.hosts.get(id);
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
    return this.registry.list().map((s) => this.toSlotInfo(s));
  }

  state(): FleetState {
    return {
      slots: this.list(),
      activeId: this.registry.getActiveId(),
      pair: this.orchestrator.getPairState(),
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

    const info = this.toSlotInfo(this.registry.get(slot.id) ?? slot);
    this.emitFleet({ type: "state", state: this.state() });
    return info;
  }

  /**
   * Reuse an existing worker/reviewer slot, or create one with the given label.
   */
  async ensureRoleSlot(
    role: "worker" | "reviewer",
    label: string,
  ): Promise<{ id: string; host: SessionHost }> {
    const existing = this.registry.list().find((s) => s.role === role);
    if (existing) {
      const host = this.hosts.get(existing.id);
      if (!host) {
        throw new Error(`槽位缺少 SessionHost: ${existing.id}`);
      }
      const status = host.getStatus();
      if (!status.hasSession) {
        const cwd = this.hosts.get("primary")?.getStatus().cwd;
        if (!cwd) {
          throw new Error("请先在主会话打开项目");
        }
        const result = await host.openProject(cwd, "new");
        if (!result.ok) {
          throw new Error(result.error ?? "无法为编排槽打开项目");
        }
        this.registry.update(existing.id, {
          cwd: result.cwd,
          sessionId: result.sessionId,
        });
      }
      return { id: existing.id, host };
    }

    const created = await this.createSlot(label, role);
    const host = this.hosts.get(created.id);
    if (!host) {
      throw new Error(`槽位缺少 SessionHost: ${created.id}`);
    }
    if (!host.getStatus().hasSession) {
      throw new Error("编排槽未能打开项目会话");
    }
    return { id: created.id, host };
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
    this.emitFleet({ type: "state", state: this.state() });
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

    if (hostBusy(this.hosts.get(id))) {
      return { ok: false, error: "槽位忙碌中，请先中止后再移除" };
    }

    const pair = this.orchestrator.getPairState();
    if (
      (pair.phase === "wave1" || pair.phase === "wave2") &&
      (pair.workerSlotId === id || pair.reviewerSlotId === id)
    ) {
      return { ok: false, error: "槽位参与并行编排中，请先中止编排" };
    }

    const wasActive = this.registry.getActiveId() === id;
    const host = this.detachHost(id);
    if (host) {
      await host.dispose();
    }
    this.registry.remove(id);

    if (wasActive) {
      const nextId = this.registry.getActiveId();
      if (nextId) {
        this.syncSlotFromHost(nextId);
        this.hosts.get(nextId)?.resyncUi();
      }
    }
    this.emitFleet({ type: "state", state: this.state() });
    return { ok: true };
  }

  async startPair(
    task: string,
  ): Promise<{ ok: boolean; error?: string; pair?: FleetPairState }> {
    const result = await this.orchestrator.startPair(task);
    this.emitFleet({ type: "state", state: this.state() });
    return result;
  }

  async abortPair(): Promise<{
    ok: boolean;
    error?: string;
    pair?: FleetPairState;
  }> {
    const result = await this.orchestrator.abortPair();
    if (result.ok) {
      await this.orchestrator.abortPairHosts((id) => this.hosts.get(id));
    }
    this.emitFleet({ type: "state", state: this.state() });
    return result;
  }

  async dispose(): Promise<void> {
    for (const unsub of this.hostUnsubs.values()) {
      unsub();
    }
    this.hostUnsubs.clear();
    const hosts = [...this.hosts.values()];
    this.hosts.clear();
    await Promise.all(hosts.map((h) => h.dispose()));
  }
}
