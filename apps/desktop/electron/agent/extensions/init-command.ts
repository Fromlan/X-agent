/**
 * `/init` slash command —— bootstrap AGENTS.md for the current project.
 *
 * Registers as a Pi extension command. The handler injects the init procedure
 * (imported as a raw markdown file at build time, mirroring the design-builtin-
 * skills pattern) as a user message, letting the model do the actual work.
 *
 * Why an extension command instead of a skill or prompt template:
 * - Skill (`/skill:init`) shows up as a separate slash-menu row with the
 *   `skill:` prefix. A bare `/init` is what users expect.
 * - Prompt template (`/name`) goes through `wrapPromptSlashAsBlock` and ends
 *   up in the model turn as a `<prompt>` block; not a clean fit for a long
 *   bootstrap procedure the model should execute.
 * - Extension command (`pi.registerCommand`) shows as a plain `/init` row,
 *   routes through `pi.sendUserMessage`, and the host returns
 *   `{ silent: true }` so the renderer drops the optimistic `/init` bubble.
 *
 * The user message is wrapped in a `<cmd name="init">…</cmd>` block so the
 * chat transcript renders it as a compact chip (parallel to `<skill>` /
 * `<prompt>` / `<file>` / `<mode>`), instead of dumping the full ~6 KB
 * bootstrap markdown as raw text in the user bubble. The model still sees
 * the inner content and acts on it.
 *
 * Side-effect free on the host side: the handler only sends a user message
 * containing cwd + date + procedure body. All file IO, prompt execution, and
 * user confirmation happen in the model turn that follows, matching the
 * existing Mavis `init` skill's behaviour (read → ask → write → tell).
 */
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import INIT_BODY from "./init/SKILL.md?raw";

export const INIT_COMMAND_NAME = "init";
export const INIT_COMMAND_DESCRIPTION = "为当前项目生成或补全根目录 AGENTS.md";

/**
 * Intro line(s) prepended to the procedure body. Tells the model the trigger
 * context (cwd + today) so it doesn't have to re-derive cwd.
 */
function buildPromptIntro(cwd: string, today: string): string {
  return [
    `/init 在 cwd=${cwd} 触发（日期 ${today}）。`,
    "",
    "请严格按下面的流程为这个项目生成（或补全）根目录的 AGENTS.md。",
    "在 pre-write check 阶段（AGENTS.md 已存在时）必须停下，等用户选择 skip / overwrite (with backup) / show diff。",
    "不要做任何超出流程的事 —— 不要顺便修改其它文件、不要 commit、不要切到其它项目。",
    "",
    "----",
    "",
  ].join("\n");
}

/**
 * Wrap the procedure body as a `<cmd name="…">…</cmd>` block so the
 * renderer renders it as a compact chip. Mirrors the `<skill>` / `<prompt>`
 * wrap pattern (see `apps/desktop/electron/agent/prompt-slash-wrap.ts` for
 * the prompt variant, and Pi's internal `_expandSkillCommand` for the skill
 * variant). The block tag is recognised by
 * `apps/desktop/src/lib/user-message-files.ts` and rendered by
 * `CmdRefChip` in `apps/desktop/src/components/UserMessageBody.tsx`.
 *
 * The `name` attribute is the bare command name (no leading slash) to match
 * how `<skill name="…" />` and `<prompt name="…" />` are emitted. Names are
 * restricted to lowercase-hyphen identifiers (see `isValidPluginName` for
 * the plugin counterpart) so escaping for `"` / `<` / `>` is not needed
 * today; if a future command name breaks that contract, escape here AND
 * teach the parser to un-escape — do not just paper over with entity refs.
 */
export function wrapCommandSlashAsBlock(
  commandName: string,
  content: string,
): string {
  return `<cmd name="${commandName}">\n${content.trimEnd()}\n</cmd>`;
}

/**
 * Inline extension factory; mirror of `createPlanModeGuardExtension` shape.
 * Returns a function that Pi calls once per session to register the command.
 */
export function createInitCommandExtension(): InlineExtension {
  return (pi) => {
    pi.registerCommand(INIT_COMMAND_NAME, {
      description: INIT_COMMAND_DESCRIPTION,
      handler: async (_args, ctx) => {
        const today = new Date().toISOString().slice(0, 10);
        const intro = buildPromptIntro(ctx.cwd, today);
        const wrapped = wrapCommandSlashAsBlock(
          INIT_COMMAND_NAME,
          `${intro}${INIT_BODY}`,
        );
        pi.sendUserMessage(wrapped);
      },
    });
  };
}
