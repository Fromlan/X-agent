/**
 * Built-in tool names togglable via `ClientPrefs.tools` (issue #60 涓婚 D C-306).
 *
 * Single source of truth 鈥?every other registry (ALL_TOGGLEABLE_TOOLS,
 * SESSION_TOOL_REGISTRY, DEFAULT_PREFS.tools) derives from this. See
 * ./derive.ts for the dedup contract.
 *
 * Adding a new built-in:
 *   1. add the name here
 *   2. (optional) implement the tool in the host's tool definitions
 *   3. the derive layer + vitest boundary test catch the new entry
 *
 * Naming convention: no `godot_` prefix (those live in ./godot.ts). The
 * ipc.test.ts boundary check enforces this at test time.
 */
export const AVAILABLE_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

export type BuiltinToolName = (typeof AVAILABLE_TOOLS)[number];
