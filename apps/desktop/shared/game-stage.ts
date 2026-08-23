/**
 * Game development workflow stages.
 *
 * A stage is a project-level workflow layer orthogonal to the existing
 * Agent / Ask / Plan / Goal session modes. Each stage supplies a distinct
 * system-prompt append and a recommended tool set so the agent can guide a
 * user through game planning, prototyping, testing, and full production.
 */

export type GameStage = "planning" | "prototype" | "testing" | "expansion";

export const GAME_STAGES: readonly GameStage[] = [
  "planning",
  "prototype",
  "testing",
  "expansion",
] as const;

export const GAME_STAGE_LABELS: Record<GameStage, string> = {
  planning: "策划",
  prototype: "原型",
  testing: "测试",
  expansion: "扩充",
};

export const GAME_STAGE_DESCRIPTIONS: Record<GameStage, string> = {
  planning: "扩展灵感、完善方案、补充配置",
  prototype: "拆解方案并制作最小可玩原型",
  testing: "游玩原型、debug 与简单完善",
  expansion: "进入正常制作阶段，完整功能开发",
};

/** Custom game-design doc writer activated in the planning stage. */
export const WRITE_GAME_DOC_TOOL = "write_game_doc" as const;

export function isGameStage(value: unknown): value is GameStage {
  return (
    typeof value === "string" &&
    (GAME_STAGES as readonly string[]).includes(value)
  );
}

/** Next stage in the workflow; returns null for the last stage. */
export function nextGameStage(stage: GameStage | null | undefined): GameStage | null {
  if (!stage) return "planning";
  const idx = GAME_STAGES.indexOf(stage);
  return idx >= 0 && idx < GAME_STAGES.length - 1 ? GAME_STAGES[idx + 1] ?? null : null;
}

export function gameStageLabel(stage: GameStage | null | undefined): string {
  if (!stage) return "未选择阶段";
  return GAME_STAGE_LABELS[stage];
}

export function gameStageDescription(
  stage: GameStage | null | undefined,
): string {
  if (!stage) return "尚未进入游戏开发流程";
  return GAME_STAGE_DESCRIPTIONS[stage];
}

function planningPrompt(): string {
  return [
    "Stage: 策划 (Planning). You are the game design coach, not a generic coding assistant.",
    "Start by expanding the user's idea: ask 1-2 focused questions, propose 2-4 playable directions, then help narrow them.",
    "When a direction is chosen, guide the user through the design sections in .game/design: Core Loop, Systems, Scope, Success Criteria.",
    "Use write_game_doc for .game/design/*.md and .game/config/*.json|yaml|toml. Do NOT modify game code, scenes, or project settings.",
    "After the design is stable, use write_plan to produce an implementation plan for the prototype stage.",
    "Conversation pattern: expand → clarify → narrow → write design → write config → write plan.",
  ].join("\n");
}

function prototypePrompt(): string {
  return [
    "Stage: 原型 (Prototype). You are the prototype builder.",
    "Ask the user which core mechanic should be proven first, then decompose the design into the smallest vertical slice.",
    "Build a runnable placeholder scene/script; keep art and systems minimal.",
    "Use Godot run/reload tools when available to verify the slice actually plays.",
    "Record what was validated in .game/prototype/NOTES.md.",
    "Do not expand scope into production features; the goal is one testable loop.",
  ].join("\n");
}

function testingPrompt(): string {
  return [
    "Stage: 测试 (Testing). You are the playtest/debug coach.",
    "Help the user play the prototype, collect feedback, and turn it into actionable bug entries.",
    "Reproduce first: ask for steps, expected vs actual; use Godot run/debugger tools to confirm the cause.",
    "Record bugs in .game/test/bugs.md and keep .game/test/playtest-checklist.md updated.",
    "Make only small fixes/regressions here; do not start large production refactors or new features.",
    "When the core loop is stable, recommend moving to 扩充/expansion.",
  ].join("\n");
}

function expansionPrompt(): string {
  return [
    "Stage: 扩充 (Expansion). You are now in normal production development.",
    "Pull tasks from .game/backlog/*.md, break them into small implementable slices, and follow project standards.",
    "Use the full toolset and maintain a runnable entry point; keep design/config and implementation in sync.",
    "Use x-review / x-tdd / x-safe-edit when appropriate.",
    "Help maintain release readiness: tests, export checks, and release checklist.",
  ].join("\n");
}

export function buildGameStageSystemAppend(stage: GameStage): string {
  const body =
    stage === "planning"
      ? planningPrompt()
      : stage === "prototype"
        ? prototypePrompt()
        : stage === "testing"
          ? testingPrompt()
          : expansionPrompt();
  return "# X-agent game stage\n" +
    `STAGE: ${stage}\n` +
    body +
    "\nThe stage is the primary workflow. Treat session modes (Ask/Plan/Goal) as temporary tools, not as the main interface.";
}

/** Serializable project-level stage state returned to the renderer. */
export interface GameStageInfo {
  stage: GameStage;
  cwd: string;
  updatedAt: number;
  schemaVersion: 1;
}
