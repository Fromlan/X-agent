import { CheckSquare, Square } from "lucide-react";
import type { ClientPrefs } from "@shared/ipc";
import type { PluginsState } from "./usePluginsState";

interface Props {
  state: PluginsState;
  allSkillsEnabled: boolean;
}

export function PluginSkillToggle({
  state,
  allSkillsEnabled,
}: Props) {
  const { isSkillTab, filtered, busy, setSkillsEnabled } = state;
  if (!isSkillTab || filtered.length === 0) return null;
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      disabled={busy}
      title={allSkillsEnabled ? "全部关闭" : "全部开启"}
      aria-label={allSkillsEnabled ? "全部关闭" : "全部开启"}
      onClick={() => {
        void setSkillsEnabled(
          filtered.map((item) => item.name),
          !allSkillsEnabled,
        );
      }}
    >
      {allSkillsEnabled ? <CheckSquare size={14} /> : <Square size={14} />}
      {allSkillsEnabled ? "全部关闭" : "全部开启"}
    </button>
  );
}

export function isSkillEnabled(prefs: ClientPrefs, skillId: string): boolean {
  const id = skillId.trim().toLowerCase();
  if (!id) return true;
  const disabled = prefs.disabledSkills ?? [];
  return !disabled.some((d) => d.trim().toLowerCase() === id);
}

export function allSkillsEnabled(
  state: PluginsState,
  prefs: ClientPrefs,
): boolean {
  if (!state.isSkillTab || state.filtered.length === 0) return true;
  return state.filtered.every((item) => isSkillEnabled(prefs, item.name));
}