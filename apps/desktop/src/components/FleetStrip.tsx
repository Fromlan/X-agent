import { Plus } from "lucide-react";
import type { FleetSlotInfo } from "@shared/ipc";

interface Props {
  slots: FleetSlotInfo[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

function roleHint(role: FleetSlotInfo["role"]): string {
  if (role === "primary") return "主";
  if (role === "reviewer") return "审";
  return "工";
}

export function FleetStrip({
  slots,
  activeId,
  busy,
  onSelect,
  onAdd,
}: Props) {
  return (
    <div className="fleet-strip" role="tablist" aria-label="Fleet 槽位">
      <span className="fleet-strip-label">Fleet</span>
      <div className="fleet-strip-slots">
        {slots.map((slot) => {
          const active = slot.id === activeId;
          return (
            <button
              key={slot.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? "fleet-chip active" : "fleet-chip"}
              onClick={() => onSelect(slot.id)}
              disabled={busy || active}
              title={slot.cwd ?? slot.label}
            >
              <span className="fleet-chip-role">{roleHint(slot.role)}</span>
              <span className="fleet-chip-label">{slot.label}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm fleet-add"
        onClick={onAdd}
        disabled={busy}
        title="添加工作区"
      >
        <Plus size={13} />
        添加工作区
      </button>
    </div>
  );
}
