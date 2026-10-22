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
  "Allowed: read / grep / find / ls / read-only bash (git status, ls, rg, …). Do not use edit, write, write_plan, or mutating bash.",
  "Skills and plugin files are readable in this mode: read SKILL.md / prompts from ~/.pi/agent/skills, project .pi/skills, and installed Packages when a task matches a skill.",
  "If the user needs an implementable plan or code changes, tell them to switch to Plan mode (for a written plan) or Agent mode (to execute).",
  "Do not pretend you already changed code.",
].join("\n");

export const PLAN_MODE_INSTRUCTIONS = [
  "You are planning only. Do NOT modify project source files.",
  "Allowed: read / grep / find / ls / write_plan / read-only bash (git status, ls, rg, …). Do not use edit, write, or mutating bash.",
  "Skills and plugin files are readable in this mode: read SKILL.md / prompts from ~/.pi/agent/skills, project .pi/skills, and installed Packages when a task matches a skill.",
  "Workflow: (1) research with read/grep/find/ls/readonly-bash as needed, (2) if requirements are still unclear emit one or more <clarify> blocks (see format below) before write_plan, (3) only then call write_plan once with a complete plan.",
  "Clarify format (exactly):\n<clarify>\nQ: Your question?\n- Option A\n- Option B\n</clarify>\nAsk at most 4 questions total. The UI lets the user pick one option per question then submit all answers together — wait for that reply before write_plan.",
  "Never call write_plan with placeholders, stubs, TODOs-as-body, or titles like placeholder/draft/草稿. Do not say you will rewrite later — research first, then write the real plan.",
  "The plan Markdown must include concrete sections: Goal, Approach, Steps (use `- [ ]` checkboxes for actionable steps), Files, Validation, Out of scope. Cite real paths and actionable steps from your research.",
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

/**
 * Design session type system append. Injected BEFORE the mode-level append
 * (ask/plan/goal) so the type constraint is always visible. Appended only
 * when the active SessionType is "design".
 *
 * v0.5+: Rewritten after a real failure (issue #40 follow-up). The previous
 * version said "You may use ask/plan/agent/goal modes internally" — that
 * phrasing made the LLM think there was an inner sub-mode, which leaked
 * plan-mode error messages into agent-mode behavior. New version:
 *   - states identity first (orthogonal to the 4 modes)
 *   - lists tools by name (whitelist > blacklist; LLM defaults to "anything
 *     not banned is allowed")
 *   - explicitly calls out cross-cwd read access so the agent doesn't waste
 *     turns trying `bash ls ../design` to read sibling project assets
 */
export const DESIGN_SESSION_TYPE_INSTRUCTIONS = [
  "You are in a Design session (策划会话). The 4 modes (ask/plan/agent/goal) share the same design tool set — switching mode does not unlock new tools or lift the game-design/ write constraint.",
  "Available tools in this session: `read`, `grep`, `find`, `ls`, `bash` (read-only commands only; path must stay inside project cwd), `write` (path must be inside `<cwd>/game-design/`), `edit` (same constraint), `godot_detect_project`.",
  "Disabled in this session: `write_plan` (策划文档直接写到 `<cwd>/game-design/`，不走 plan 流程); `godot_set_project_setting` and other unlisted Godot mutating tools are blocked by the design-write-guard. If the user wants code changes, tell them to open a Code session (新代码会话).",
  "Cross-project reference: 策划需要参考其他项目的设计资产时, 可以用 `read` / `grep` / `find` / `ls` 直接读**项目外任意路径** (这些 read 系列工具不受 design-write-guard 限制), 但**不要用 bash 访问项目外路径** — bash 的 cwd sandbox 会拦截.",
  'Writing GDD: when the user says "整理 / 写入" 设计文档, follow the project\'s existing structure and requested scope (see layout guide below). Create only documents needed for the requested deliverable.',
].join("\n");

export function buildDesignSessionTypeAppend(): string {
  return ["# X-agent Design session type", DESIGN_SESSION_TYPE_INSTRUCTIONS].join(
    "\n",
  );
}

/**
 * Tool economy — read with offset/limit, write in pieces, batch independent
 * reads. Injected for every session type (code + design) so the LLM does
 * not default to "read the whole 25KB file" + "write a brand-new 25KB file"
 * in one turn, which is exactly how the 195k-context blowup happened.
 *
 * Injected as a stable prefix block between the type append and the
 * mode-specific append; updating this string bumps the system-prompt cache
 * key for every active session, so keep it short and durable.
 */
export const TOOL_ECONOMY_INSTRUCTIONS = [
  "Search paths and symbols first with grep/find or rg when available. Read relevant sections with offset/limit; read an instruction file in full when required. Avoid repeated full-file reads and unbounded command output.",
  "Batch independent reads when supported. Keep dependent edits and verification sequential; inspect results before choosing the next step.",
  "Prefer edit for existing files and write for new files or intentional rewrites. Split large changes into coherent, complete patches; never replace required content with placeholders to save tokens.",
  "Work in bounded batches, then verify and continue in the same task. Batching controls context size; it is not a reason to stop and wait for the user to say continue.",
].join("\n");

export function buildToolEconomyAppend(): string {
  return ["# X-agent Tool economy", TOOL_ECONOMY_INSTRUCTIONS].join("\n");
}

/**
 * Completion discipline is mode-aware so persistence does not imply writes
 * during research or planning. Keep it stable and short for prompt caching.
 */
export const COMPLETION_DISCIPLINE_INSTRUCTIONS = [
  "Before ending, verify every requested part is complete within the active mode. Agent implements and checks; Ask answers with evidence; Plan delivers a researched plan; Goal requires evidence for its condition.",
  "After changes, run relevant verification (tests, build, lint, or runtime checks). Report what actually ran and passed or failed; a grep or code inspection alone does not prove runtime behavior.",
  "If blocked, state the blocker, what you tried, and what remains. Never claim completion for a partial solution or an unrun check.",
  "Continue the same task while authorized steps remain. Do not repeat successful checks unless new changes or unresolved concerns justify it.",
  "Avoid exhausting the output budget (max_tokens) in unbroken reasoning. Take a useful tool step to checkpoint observable progress before the response is truncated.",
].join("\n");

export function buildCompletionDisciplineAppend(): string {
  return ["# X-agent Completion discipline", COMPLETION_DISCIPLINE_INSTRUCTIONS].join("\n");
}

/**
 * GDD layout guidance follows the current project's domain and requested scope.
 * 由 controller.composeModeAppend 在 design session 追加在 type append 之后。
 *
 * Keep game-specific templates out of the permanent append so a past project
 * cannot dictate unrelated games' systems or create unnecessary documents.
 */
export function buildGameDesignLayoutGuide(): string {
  return [
    "# X-agent GDD layout guide (策划会话)",
    "Write requested design documents inside `<cwd>/game-design/`. Inspect existing design files first; preserve their names, terminology, and organization. Update the relevant document instead of creating duplicate summaries or unrelated audit/integration documents.",
    "For a new design, start with a 主设计文档 covering the experience goal, core loop, rules, and validation criteria. Split out systems only when the game's scope or the user requires it; do not assume a genre, fixed document count, or systems from another project.",
    "Separate confirmed requirements, proposed rules, and open questions. Preserve concrete values and sources; label assumptions and missing data instead of inventing them. Organize source material into usable rules rather than copying it wholesale.",
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
