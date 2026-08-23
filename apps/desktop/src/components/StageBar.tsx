import { Box, Check, Circle, FlaskConical, Lightbulb, Rocket } from "lucide-react";
import { useState } from "react";
import type { StageId, StageInfo } from "@shared/ipc";
import { STAGE_LABELS } from "@shared/stage";
import { StageSwitchModal } from "./StageSwitchModal";

interface Props {
  stageInfo: StageInfo | null;
  busy: boolean;
  onSwitch: (target: StageId) => Promise<unknown>;
  onToggleCheck: (checkId: string, value: boolean) => void;
}

const STAGE_ICONS: Record<StageId, typeof Lightbulb> = {
  design: Lightbulb,
  prototype: Box,
  test: FlaskConical,
  expand: Rocket,
};

const STAGE_ORDER: StageId[] = ["design", "prototype", "test", "expand"];

export function StageBar({ stageInfo, busy, onSwitch, onToggleCheck }: Props) {
  const [pendingTarget, setPendingTarget] = useState<StageId | null>(null);

  if (!stageInfo) {
    return (
      <div className="stage-bar stage-bar--empty" aria-hidden>
        <span className="stage-bar-hint">打开项目后显示阶段进度</span>
      </div>
    );
  }

  const current = stageInfo.current;
  const currentIndex = STAGE_ORDER.indexOf(current);

  const handleClick = (target: StageId) => {
    if (target === current || busy) return;
    setPendingTarget(target);
  };

  const handleConfirm = async (target: StageId) => {
    const result = await onSwitch(target);
    setPendingTarget(null);
    return result;
  };

  return (
    <div className="stage-bar" role="group" aria-label="开发阶段">
      {STAGE_ORDER.map((id, idx) => {
        const Icon = STAGE_ICONS[id];
        const status: "done" | "current" | "future" =
          idx < currentIndex
            ? "done"
            : idx === currentIndex
              ? "current"
              : "future";
        const stage = stageInfo.definition.id === id
          ? stageInfo
          : null;
        // For non-current stages we have a single stageInfo, so we only know
        // current graduation. The label and progress ring use that single bundle.
        const passed = stage?.graduation.passed ?? 0;
        const total = stage?.graduation.total ?? 0;
        return (
          <button
            key={id}
            type="button"
            className={`stage-bar-step stage-bar-step--${status}`}
            data-stage={id}
            disabled={status === "future" || busy}
            onClick={() => handleClick(id)}
            title={
              status === "future"
                ? `${STAGE_LABELS[id]}（按顺序进行）`
                : status === "done"
                  ? `已完成：${STAGE_LABELS[id]}`
                  : `当前：${STAGE_LABELS[id]}`
            }
            aria-current={status === "current" ? "step" : undefined}
          >
            <span className="stage-bar-icon">
              {status === "done" ? (
                <Check size={12} aria-hidden />
              ) : status === "current" ? (
                <Icon size={13} aria-hidden />
              ) : (
                <Circle size={11} aria-hidden />
              )}
            </span>
            <span className="stage-bar-label">{STAGE_LABELS[id]}</span>
            {status === "current" && total > 0 && (
              <span className="stage-bar-progress" aria-label={`毕业条件 ${passed}/${total}`}>
                {passed}/{total}
              </span>
            )}
          </button>
        );
      })}
      {pendingTarget && (
        <StageSwitchModal
          target={pendingTarget}
          stageInfo={stageInfo}
          onCancel={() => setPendingTarget(null)}
          onConfirm={() => handleConfirm(pendingTarget)}
          onToggleCheck={onToggleCheck}
        />
      )}
    </div>
  );
}
