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
  'Writing GDD: when the user says "整理 / 写入" 设计文档, follow the standard GDD skeleton (see layout guide below). Do NOT produce a summary.md / audit.md / integration-plan.md / engine-*.md unless the user explicitly asks.',
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
  "Read with offset/limit. For files > 500 lines, pass `offset` and `limit` (e.g. `offset=1 limit=200`) to page through. Avoid reading entire 25KB files into context when you only need a section.",
  "Independent reads in the same round. When several reads have no data dependency (multiple source files you will cross-reference), issue them together in one assistant turn so they execute in parallel.",
  "Edit, don't rewrite. Use `edit` (search/replace) for existing files. Use `write` only for new files or full rewrites — and keep `content` small. Single-shot `write` of multi-thousand-char content is the most common way to blow the context window.",
  "Multi-file work across turns. Don't read all source files then write all new files in one turn. Read 1–2 files, plan, write 1–2 files, let the user (or the next turn) review before continuing.",
].join("\n");

export function buildToolEconomyAppend(): string {
  return ["# X-agent Tool economy", TOOL_ECONOMY_INSTRUCTIONS].join("\n");
}

/**
 * Completion discipline — when to stop, when to keep going. Injected for every
 * session type and every mode (Agent / Ask / Plan / Goal) because the
 * underlying issue is universal: MiniMax-M3 (and any LLM leaning concise)
 * ends the turn after a small edit without verifying the change actually
 * addressed the user's request. Goal mode has a stronger version of this
 * rule, but Ask / Agent / Plan need it too. Sits after `Tool economy` and
 * before the mode-specific append, so the order is "how to work" → "when to
 * stop" → "mode-specific shape". Keep this short and durable; updating the
 * string bumps the system-prompt cache key for every active session.
 */
export const COMPLETION_DISCIPLINE_INSTRUCTIONS = [
  "Before ending the turn, verify the user's request is actually complete — not just plausible from reading code.",
  "If you made changes, run a verification step (test, build, lint, simulation, or grep on the changed file) and report the actual output.",
  "If the request has multiple parts (numbered list, several sub-asks), address each part and confirm each before saying 'done'.",
  "If a step is blocked, name the blocker explicitly and what you tried — do not declare 'done' on a partial solution.",
  "Default to continuing the same task in the same turn when more steps remain, instead of stopping for the user to say 'continue'.",
  "Long unbroken thinking can exhaust your output budget (max_tokens), leaving the turn truncated with no text or tool call. If you have been reasoning for a while without emitting one, stop and emit a tool call (read / grep / edit / run) to checkpoint. The next turn continues from your tool results, not from your thoughts.",
].join("\n");

export function buildCompletionDisciplineAppend(): string {
  return ["# X-agent Completion discipline", COMPLETION_DISCIPLINE_INSTRUCTIONS].join("\n");
}

/**
 * GDD 布局引导 —— 给"整理/写入设计文档"任务列标准子模块。
 * 由 controller.composeModeAppend 在 design session 追加在 type append 之后。
 *
 * 设计取舍: 不强制 agent 全写 (不同策划阶段需要的 GDD 子集不同),
 * 但显式禁止 summary/audit/integration-plan 这 4 个变体 — 那是
 * #40 follow-up 对话里 agent 的实际错误路径。
 */
export function buildGameDesignLayoutGuide(): string {
  const sections = [
    {
      name: "01-主设计文档.md",
      purpose: "游戏总纲: 一句话定位、核心循环、设计支柱、9 个核心系统 (棋子/羁绊/经济/爬塔/法宝/战斗/建筑/峰/难度)",
    },
    {
      name: "02-棋子图鉴.md",
      purpose: "每个棋子的属性、技能、定位、speed 档位 (如适用, 也叫'角色图鉴')",
    },
    {
      name: "03-羁绊效果.md",
      purpose: "羁绊/职业/种族的激活条件、数值、Combo 表",
    },
    {
      name: "04-法宝图鉴.md",
      purpose: "装备/法宝的触发、效果、合成 (如适用, 也叫'装备图鉴')",
    },
    {
      name: "05-建筑数值.md",
      purpose: "建筑/城池/基地的升级、产出、玩家等级",
    },
    {
      name: "06-敌人阵容.md",
      purpose: "敌方单位、阵容、难度梯度、Boss 列表",
    },
    {
      name: "07-峰的选择.md",
      purpose: "玩家初始身份/种族/职业的独特加成、初始棋子、克制链 (如适用, 也叫'职业选择'/'出身选择')",
    },
    {
      name: "08-事件奇遇.md",
      purpose: "随机/分支事件、道德/善恶系统、事件链",
    },
    {
      name: "09-章节与Boss.md",
      purpose: "主线/关卡流程、Boss 技能、章节奖励",
    },
  ];
  const header = [
    "# X-agent GDD layout guide (策划会话)",
    "",
    'When the user says "整理 / 写入" 设计文档 to `<cwd>/game-design/`, write one markdown file per row below. Use 1 行文件名 + 1 行问题说明 + 实际内容 (具体数值/列表/效果).',
    "",
    "如果项目已有自己的命名 (比如'角色'替代'棋子', '出身'替代'峰'), 沿用项目约定; 文件名里那一截也可以替换。",
    "",
    "Do NOT produce a summary.md / audit.md / integration-plan.md / engine-*.md unless the user explicitly asks. 不要把原始策划案**逐字复制**过来当成 game-design/ 的内容 — 整理的意思是按下面的骨架写。",
    "",
  ].join("\n");
  const body = sections
    .map((s) => `- **${s.name}** — ${s.purpose}`)
    .join("\n");
  return header + body;
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
