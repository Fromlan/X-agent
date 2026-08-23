import {
  ArrowRight,
  Bug,
  Hammer,
  Lightbulb,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import type { GameStage } from "@shared/game-stage";
import {
  GAME_STAGES,
  GAME_STAGE_DESCRIPTIONS,
  GAME_STAGE_LABELS,
  nextGameStage,
} from "@shared/game-stage";

const STAGE_ICONS: Record<GameStage, LucideIcon> = {
  planning: Lightbulb,
  prototype: Hammer,
  testing: Bug,
  expansion: Rocket,
};

interface Props {
  stage: GameStage | null;
  onChange?: (stage: GameStage) => void;
  disabled?: boolean;
}

/** Primary stage selector + current guidance + next-stage action. */
export function GameStageBar({ stage, onChange, disabled }: Props) {
  const next = nextGameStage(stage);
  const nextLabel = next ? GAME_STAGE_LABELS[next] : null;

  return (
    <div className="game-stage-bar" role="group" aria-label="游戏开发阶段">
      <div className="game-stage-chips">
        {GAME_STAGES.map((s) => {
          const Icon = STAGE_ICONS[s];
          const active = s === stage;
          return (
            <button
              key={s}
              type="button"
              className={`game-stage-chip${active ? " is-active" : ""}`}
              aria-pressed={active}
              disabled={disabled || !onChange}
              onClick={() => onChange?.(s)}
              title={GAME_STAGE_DESCRIPTIONS[s]}
            >
              <Icon size={13} aria-hidden />
              <span>{GAME_STAGE_LABELS[s]}</span>
            </button>
          );
        })}
      </div>
      <div className="game-stage-hint">
        {stage ? (
          <>
            <strong>{GAME_STAGE_LABELS[stage]}</strong>
            <span> · {GAME_STAGE_DESCRIPTIONS[stage]}</span>
          </>
        ) : (
          <span>选择阶段开始游戏开发流程</span>
        )}
      </div>
      {stage && next && nextLabel && (
        <button
          type="button"
          className="btn btn-secondary btn-sm game-stage-next"
          disabled={disabled || !onChange}
          onClick={() => onChange?.(next)}
          title={`完成当前阶段后进入：${nextLabel}`}
        >
          <ArrowRight size={13} aria-hidden />
          进入{nextLabel}
        </button>
      )}
    </div>
  );
}
