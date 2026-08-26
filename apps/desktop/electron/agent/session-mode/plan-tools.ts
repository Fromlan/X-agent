/**
 * Plan-mode helpers: plans directory, tool allowlist, write_plan custom tool.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  PLAN_MODE_CORE_TOOLS,
  PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS,
  PLAN_MODE_OPTIONAL_READONLY_TOOLS,
  READONLY_CORE_TOOLS,
  WRITE_PLAN_TOOL,
} from "../../../shared/mode-tools";
import {
  PLAN_MODE_INSTRUCTIONS,
  wrapWithModeBlock,
} from "../../../shared/mode-prompt";
import { getAgentDirPath } from "../prefs";
import type { SessionTypePolicy } from "../session-type-policy";

export { PLAN_MODE_INSTRUCTIONS, wrapWithModeBlock };

export type PlanLocation = "home" | "workspace" | "other";

export function buildImplementPrompt(planPath: string): string {
  return wrapWithModeBlock(
    "build",
    [
      "Implement the approved plan strictly.",
      `Plan file (read it first): ${planPath}`,
      "Follow Steps in order. Stay within Files / Out of scope.",
      "Run Validation commands when listed; fix failures or report a clear blocker.",
      "Do not expand scope beyond the plan.",
    ].join("\n"),
  );
}

export function getPlansDir(): string {
  return join(getAgentDirPath(), "x-agent", "plans");
}

/** Project-local plans (Cursor-style "Save to workspace"). */
export function getWorkspacePlansDir(cwd: string): string {
  return join(cwd, ".pi", "plans");
}

function isPathInside(parent: string, child: string): boolean {
  const root = resolve(parent);
  const target = resolve(child);
  if (target === root) return true;
  // Windows NTFS / ReFS 默认大小写不敏感 —— 前缀比对先做 lowercase 归一化。
  const rootLower = root.toLowerCase();
  const targetLower = target.toLowerCase();
  const prefix = rootLower.endsWith(sep) ? rootLower : rootLower + sep;
  return targetLower.startsWith(prefix);
}

export function classifyPlanLocation(
  planPath: string,
  cwd: string | null,
): PlanLocation {
  if (isPathInside(getPlansDir(), planPath)) return "home";
  if (cwd && isPathInside(getWorkspacePlansDir(cwd), planPath)) {
    return "workspace";
  }
  return "other";
}

/** Only home or workspace plan roots are editable via IPC. */
export function isAllowedPlanPath(
  planPath: string,
  cwd: string | null,
): boolean {
  const loc = classifyPlanLocation(planPath, cwd);
  return loc === "home" || loc === "workspace";
}

export function readPlanMarkdown(planPath: string): string {
  return readFileSync(planPath, "utf8");
}

export function writePlanMarkdown(planPath: string, markdown: string): void {
  const body = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  mkdirSync(dirname(planPath), { recursive: true });
  writeFileSync(planPath, body, "utf8");
}

/**
 * Copy plan into `<cwd>/.pi/plans/` and return the new path.
 * Removes the home-dir original when the source was under the home plans dir.
 */
export function savePlanToWorkspacePath(
  planPath: string,
  cwd: string,
): string {
  if (!existsSync(planPath)) {
    throw new Error("计划文件不存在");
  }
  const dir = getWorkspacePlansDir(cwd);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, basename(planPath));
  const srcResolved = resolve(planPath);
  const destResolved = resolve(dest);
  if (srcResolved !== destResolved) {
    copyFileSync(planPath, dest);
    if (isPathInside(getPlansDir(), planPath)) {
      try {
        unlinkSync(planPath);
      } catch {
        // keep dest even if home cleanup fails
      }
    }
  }
  return dest;
}

/** Slugify a plan title for the filename (safe ASCII / alnum). */
export function slugifyPlanTitle(title: string): string {
  const raw = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return raw || "plan";
}

export function formatPlanTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function buildPlanFilePath(title: string, d = new Date()): string {
  const name = `${formatPlanTimestamp(d)}-${slugifyPlanTitle(title)}.md`;
  return join(getPlansDir(), name);
}

/** Optional read-only Godot tools already enabled in user prefs. */
function appendOptionalReadonlyGodotTools(
  tools: string[],
  prefsTools: readonly string[],
): void {
  const prefs = new Set(prefsTools);
  for (const name of PLAN_MODE_OPTIONAL_READONLY_TOOLS) {
    if (prefs.has(name)) tools.push(name);
  }
  // 扩展工具由 godot-pi Package 注册到 Pi 扩展运行时,不进 prefs 开关表;
  // 它们是纯只读 fs 探测,Plan/Ask 模式默认放行,免得调研场景每次都得先去设置勾选。
  tools.push(...PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS);
}

/**
 * Tools active in Ask (调研) mode: core read-only + optional Godot read-only
 * from prefs. No write_plan.
 */
export function computeAskModeTools(prefsTools: readonly string[]): string[] {
  const tools: string[] = [...READONLY_CORE_TOOLS];
  appendOptionalReadonlyGodotTools(tools, prefsTools);
  return tools;
}

/**
 * Tools active in Plan mode: core read-only + write_plan, plus optional
 * Godot read-only tools that are already enabled in user prefs.
 */
export function computePlanModeTools(prefsTools: readonly string[]): string[] {
  const tools: string[] = [...PLAN_MODE_CORE_TOOLS];
  appendOptionalReadonlyGodotTools(tools, prefsTools);
  return tools;
}

/** True when mode uses a temporary read-only tool set (not prefs.tools). */
export function isReadonlySessionMode(mode: string): boolean {
  return mode === "ask" || mode === "plan";
}

/** Active tools for ask/plan from prefs; agent/goal use prefs as-is. */
export function computeModeTools(
  mode: "ask" | "plan",
  prefsTools: readonly string[],
): string[] {
  return mode === "ask"
    ? computeAskModeTools(prefsTools)
    : computePlanModeTools(prefsTools);
}

/**
 * Compute the active tool set given BOTH the session type and the current mode.
 * Session type "design" overrides the per-mode derivation: even in agent /
 * goal mode the design session should not get the full prefs.tools (which
 * usually includes write/edit/bash and godot mutating tools). Instead it
 * gets the design base (read-only + write/edit guarded by game-design/).
 *
 * Code session type falls through to the existing per-mode logic.
 *
 * Type decisions are centralized in `SessionTypePolicy`; this function
 * takes a policy and reads `policy.toolPreset(...)` for the design branch.
 */
export function computeModeToolsForType(
  policy: SessionTypePolicy,
  mode: "ask" | "plan" | "agent" | "goal",
  prefsTools: readonly string[],
): string[] {
  if (policy.type === "design") {
    // ask is read-only by definition; use the design base (which is
    // already readonly + write). This avoids giving the agent the
    // ability to write even in plan/agent mode without path check.
    // plan / agent / goal: also the design base. The design-write-guard
    // extension is the authoritative path check; mode-level narrow
    // (write_plan removal) is already reflected in the design base.
    return [...policy.toolPreset(prefsTools)];
  }
  // Code session: existing behavior.
  if (mode === "ask") return computeAskModeTools(prefsTools);
  if (mode === "plan") return computePlanModeTools(prefsTools);
  // agent / goal: full prefs.tools.
  return [...prefsTools];
}

/** Filter write_plan out of a tool list (e.g. when capturing savedTools). */
export function withoutWritePlan(tools: readonly string[]): string[] {
  return tools.filter((n) => n !== WRITE_PLAN_TOOL);
}

const STUB_PLAN_TITLES = new Set([
  "placeholder",
  "draft",
  "todo",
  "temp",
  "tmp",
  "plan",
  "stub",
  "tbd",
  "占位",
  "占位计划",
  "草稿",
  "临时",
]);

/**
 * Reject early stub write_plan calls that leave empty/placeholder plans in the UI.
 * Returns an error message, or null if the plan looks usable.
 */
export function stubPlanRejection(title: string, markdown: string): string | null {
  const trimmedTitle = title.trim();
  const titleKey = trimmedTitle.toLowerCase();
  if (!trimmedTitle || STUB_PLAN_TITLES.has(titleKey)) {
    return (
      "Rejected: title looks like a placeholder. Finish research, then call " +
      "write_plan once with a descriptive title and a complete Markdown plan."
    );
  }

  const body = markdown.trim();
  if (body.length < 160) {
    return (
      "Rejected: plan body is too short / incomplete. Do not write stubs. " +
      "Research first, then provide Goal, Approach, Steps, Files, Validation, Out of scope."
    );
  }

  const stubBody =
    /^(#\s*)?(placeholder|draft|todo|stub|tbd|占位|草稿)\b/i.test(body) &&
    body.length < 400;
  if (stubBody) {
    return (
      "Rejected: plan body is a placeholder. Research with read/grep/find/ls, " +
      "then write_plan with concrete paths and steps."
    );
  }

  const hasGoal = /##\s*(goal|目标)\b/i.test(body);
  const hasSteps = /##\s*(steps|步骤)\b/i.test(body);
  if (!hasGoal || !hasSteps) {
    return (
      "Rejected: missing required sections. Include at least ## Goal and ## Steps " +
      "(Chinese ## 目标 / ## 步骤 also ok), plus Approach, Files, Validation, Out of scope."
    );
  }

  return null;
}

export function createWritePlanTools(
  onPlanWritten: (path: string) => void,
  getCurrentPlanPath?: () => string | null,
): ToolDefinition[] {
  return [
    defineTool({
      name: "write_plan",
      label: "Write plan",
      description:
        "Write the final Markdown implementation plan after research is done. " +
        "Call once with a complete plan (never placeholders/stubs). " +
        "Same-session calls overwrite the current plan file. " +
        "After success the user edits it in the right panel and clicks 「执行计划」.",
      parameters: Type.Object({
        title: Type.String({
          description:
            "Short descriptive plan title for the filename (not placeholder/draft)",
        }),
        markdown: Type.String({
          description:
            "Complete Markdown plan: Goal, Approach, Steps, Files, Validation, Out of scope — with real paths and actionable steps",
        }),
      }),
      async execute(_toolCallId, params) {
        const title =
          typeof params.title === "string" && params.title.trim()
            ? params.title.trim()
            : "";
        const markdown =
          typeof params.markdown === "string" ? params.markdown : "";
        const rejection = stubPlanRejection(title || "plan", markdown);
        if (rejection) {
          throw new Error(rejection);
        }

        const dir = getPlansDir();
        mkdirSync(dir, { recursive: true });
        const existing = getCurrentPlanPath?.() ?? null;
        const path =
          existing && existsSync(existing) ? existing : buildPlanFilePath(title);
        const body = markdown.startsWith("#")
          ? markdown
          : `# ${title}\n\n${markdown}`;
        writeFileSync(path, body.endsWith("\n") ? body : `${body}\n`, "utf8");
        onPlanWritten(path);
        return {
          content: [
            {
              type: "text" as const,
              text: `Plan written to ${path}. Ask the user to review it in the right-panel Plan tab and click 「执行计划」 when ready.`,
            },
          ],
          details: { path, title },
        };
      },
    }),
  ];
}
