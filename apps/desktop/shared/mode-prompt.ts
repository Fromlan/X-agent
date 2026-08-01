/**
 * Session-mode instructions for Ask / Plan / Goal / Build.
 *
 * Ask, Plan & Goal: injected into the system prompt append while the mode is
 * active (see SessionHost.appendSystemPromptOverride) — user bubbles stay clean.
 * Build: one-shot user message still uses `<mode>` so the transcript can show
 * a compact @Build chip.
 */

export type SessionModePromptName = "ask" | "plan" | "goal" | "build";

export const MODE_BLOCK_RE =
  /<mode\s+name="([^"]*)"\s*>\r?\n?([\s\S]*?)\r?\n?<\/mode>/g;

export const ASK_MODE_INSTRUCTIONS = [
  "You are in Ask (调研) mode: answer questions and research the codebase. Do NOT modify project source files.",
  "Allowed: read / grep / find / ls (and any read-only Godot tools already enabled). Do not use bash, edit, write, or write_plan.",
  "If the user needs an implementable plan or code changes, tell them to switch to Plan mode (for a written plan) or Agent mode (to execute).",
  "Do not pretend you already changed code.",
].join("\n");

export const PLAN_MODE_INSTRUCTIONS = [
  "You are planning only. Do NOT modify project source files.",
  "Allowed: read / grep / find / ls (and write_plan). Do not use bash, edit, or write on project files.",
  "Workflow: (1) research with read/grep/find/ls as needed, (2) if requirements are still unclear ask up to 4 clarifying multiple-choice questions, (3) only then call write_plan once with a complete plan.",
  "Never call write_plan with placeholders, stubs, TODOs-as-body, or titles like placeholder/draft/草稿. Do not say you will rewrite later — research first, then write the real plan.",
  "The plan Markdown must include concrete sections: Goal, Approach, Steps, Files, Validation, Out of scope. Cite real paths and actionable steps from your research.",
  "If the user asks for changes after a plan exists, call write_plan again with a full replacement (same session overwrites the current plan file).",
  "After writing the plan, summarize briefly and tell the user to review/edit it in the right-panel Plan tab, then click 「执行计划」 to implement.",
  "Do not pretend you already changed code.",
].join("\n");

export const GOAL_MODE_INSTRUCTIONS = [
  "Work until the GOAL CONDITION above holds.",
  "Produce verifiable evidence in the transcript (tests, commands, file checks).",
  "Do not stop after a partial step if the condition is still unmet.",
].join("\n");

export function buildAskModeSystemAppend(): string {
  return ["# X-agent Ask mode", ASK_MODE_INSTRUCTIONS].join("\n");
}

export function buildPlanModeSystemAppend(): string {
  return ["# X-agent Plan mode", PLAN_MODE_INSTRUCTIONS].join("\n");
}

export function buildGoalModeSystemAppend(condition: string): string {
  return [
    "# X-agent Goal mode",
    `GOAL CONDITION: ${condition}`,
    GOAL_MODE_INSTRUCTIONS,
  ].join("\n");
}

export function wrapWithModeBlock(
  name: SessionModePromptName,
  instructions: string,
  userText?: string,
): string {
  const body = instructions.trimEnd();
  const block = `<mode name="${name}">\n${body}\n</mode>`;
  const rest = (userText ?? "").trim();
  return rest ? `${block}\n\n${rest}` : block;
}

/** Strip mode blocks for composer edit drafts. */
export function stripModeBlocks(text: string): string {
  if (!text.includes("<mode")) return text;
  MODE_BLOCK_RE.lastIndex = 0;
  return text
    .replace(MODE_BLOCK_RE, "")
    .replace(/^\s+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function modeBlockLabel(name: string): string {
  if (name === "ask") return "调研";
  if (name === "plan") return "Plan";
  if (name === "goal") return "目标";
  if (name === "build") return "执行计划";
  return name || "mode";
}
