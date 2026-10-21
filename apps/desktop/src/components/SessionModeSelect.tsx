/** Reuse the keyboard-accessible select so four session modes occupy one control. */
import { Bot, ClipboardList, Search, Target } from "lucide-react";
import type { AgentSessionMode } from "@shared/ipc";
import { SelectMenu } from "./SelectMenu";

const MODES = [
  { value: "agent", label: "智能体", title: "执行任务并修改文件", icon: Bot },
  { value: "ask", label: "调研", title: "只读研究与问答，不改文件", icon: Search },
  { value: "plan", label: "计划", title: "只读研究并写出计划", icon: ClipboardList },
  { value: "goal", label: "目标", title: "设定完成条件并自动续轮", icon: Target },
] satisfies { value: AgentSessionMode; label: string; title: string; icon: typeof Bot }[];

/** Preserve the mode guard and leave Shift+Tab cycling with the owning chat panel. */
export function SessionModeSelect({ value, disabled, onChange }: {
  value: AgentSessionMode;
  disabled: boolean;
  onChange?: (mode: AgentSessionMode) => void;
}) {
  const mode = MODES.find((candidate) => candidate.value === value) ?? MODES[0];
  const Icon = mode.icon;
  return (
    <div className="composer-mode-select" data-mode={value}>
      <Icon size={14} aria-hidden />
      <SelectMenu
        variant="pill"
        value={value}
        options={MODES}
        onChange={(next) => {
          const selected = MODES.find((candidate) => candidate.value === next);
          if (selected) onChange?.(selected.value);
        }}
        disabled={disabled || !onChange}
        aria-label="会话模式"
        title={`${mode.title}（Shift+Tab 切换）`}
      />
    </div>
  );
}
