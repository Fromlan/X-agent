import { GitBranchPlus, Plus, X } from "lucide-react";
import type { FleetPairState, FleetSlotInfo } from "@shared/ipc";

interface Props {
  slots: FleetSlotInfo[];
  activeId: string | null;
  busy: boolean;
  pair: FleetPairState;
  onSelect: (id: string) => void;
  onAddWorker: () => void;
  onAddReviewer: () => void;
  onRemove: (id: string) => void;
  onAbortPair: () => void;
}

function roleHint(role: FleetSlotInfo["role"]): string {
  if (role === "primary") return "主";
  if (role === "reviewer") return "审";
  return "工";
}

function pairPhaseLabel(pair: FleetPairState): string | null {
  if (pair.phase === "wave1") return "并行 Wave1";
  if (pair.phase === "wave2") return "审阅 Wave2";
  if (pair.phase === "done") return "编排完成";
  if (pair.phase === "aborted") return "编排已中止";
  if (pair.phase === "error") return "编排出错";
  return null;
}

export function FleetStrip({
  slots,
  activeId,
  busy,
  pair,
  onSelect,
  onAddWorker,
  onAddReviewer,
  onRemove,
  onAbortPair,
}: Props) {
  const pairActive = pair.phase === "wave1" || pair.phase === "wave2";
  const phaseLabel = pairPhaseLabel(pair);

  return (
    <div className="fleet-strip" role="tablist" aria-label="Fleet 槽位">
      <span className="fleet-strip-label">Fleet</span>
      <div className="fleet-strip-slots">
        {slots.map((slot) => {
          const active = slot.id === activeId;
          const canRemove = slot.role !== "primary" && !slot.busy && !busy;
          return (
            <div
              key={slot.id}
              className={
                active ? "fleet-chip-wrap active" : "fleet-chip-wrap"
              }
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "fleet-chip active" : "fleet-chip"}
                onClick={() => onSelect(slot.id)}
                disabled={busy || active}
                title={slot.cwd ?? slot.label}
              >
                <span
                  className={
                    slot.busy
                      ? "fleet-chip-busy is-busy"
                      : "fleet-chip-busy"
                  }
                  aria-hidden
                />
                <span className="fleet-chip-role">{roleHint(slot.role)}</span>
                <span className="fleet-chip-label">{slot.label}</span>
              </button>
              {slot.role !== "primary" && (
                <button
                  type="button"
                  className="fleet-chip-remove"
                  onClick={() => onRemove(slot.id)}
                  disabled={!canRemove || pairActive}
                  title={
                    slot.busy || pairActive
                      ? "忙碌或编排中，无法移除"
                      : "移除槽位"
                  }
                  aria-label={`移除 ${slot.label}`}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {phaseLabel && (
        <span
          className={
            pair.phase === "error"
              ? "fleet-pair-status is-error"
              : "fleet-pair-status"
          }
          title={pair.message ?? pair.task}
        >
          <GitBranchPlus size={12} />
          {phaseLabel}
        </span>
      )}
      {pairActive && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onAbortPair}
          disabled={busy}
          title="中止并行编排"
        >
          中止编排
        </button>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm fleet-add"
        onClick={onAddWorker}
        disabled={busy}
        title="添加实现工作区"
      >
        <Plus size={13} />
        工作区
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm fleet-add"
        onClick={onAddReviewer}
        disabled={busy}
        title="添加审阅槽"
      >
        <Plus size={13} />
        审阅
      </button>
    </div>
  );
}
