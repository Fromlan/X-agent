/**
 * Derived tool registries (issue #60 涓婚 D C-306).
 *
 * Two consumers exist:
 *
 * 1. `ALL_TOGGLEABLE_TOOLS` 鈥?every tool togglable via `ClientPrefs.tools`
 *    (= `AVAILABLE_TOOLS` 鈭?`GODOT_TOOLS`). Used by:
 *      - `app-runtime.ts`  鈫?validate the renderer-supplied `tools` patch
 *      - `session-host.ts` 鈫?re-hydrate the runtime tool set
 *
 * 2. `SESSION_TOOL_REGISTRY` 鈥?every tool name passed to
 *    `createAgentSession` (= ALL_TOGGLEABLEABLE 鈭?`{ write_plan }`).
 *    `write_plan` is a custom tool, not a settings toggle, so it lives
 *    in `mode-tools.ts`. Used by:
 *      - `session-lifecycle.ts` 鈫?seed the registry before createAgentSession
 *      - `scripts/test-plan-mode-tools.ts` 鈫?regression check
 *
 * Both registries are produced by `deriveToolList` (./derive.ts) so
 * duplicate source entries throw at module load instead of silently
 * producing a list that crashes Pi's `setActiveToolsByName` at session
 * start. The boundary test in derive.test.ts adds an explicit
 * `no-duplicate` / `length === sum` check.
 */
import { deriveToolList } from "./derive";
import { AVAILABLE_TOOLS } from "./available";
import { GODOT_TOOLS } from "./godot";
import { WRITE_PLAN_TOOL } from "../mode-tools";

/** All builtins + all Godot editor tools, in declaration order. */
export const ALL_TOGGLEABLE_TOOLS = deriveToolList(AVAILABLE_TOOLS, GODOT_TOOLS);

/**
 * Toggleable tools + the Plan-mode-only `write_plan` custom tool.
 * This is the full set passed to `createAgentSession` as
 * `tools: [...SESSION_TOOL_REGISTRY]`.
 */
export const SESSION_TOOL_REGISTRY = deriveToolList(
  ALL_TOGGLEABLE_TOOLS,
  [WRITE_PLAN_TOOL] as const,
);
