/**
 * Ask/Plan hard gate: block non-allowlisted tools via Pi tool_call extension.
 * Bash is allowlisted but commands must pass the read-only classifier + cwd check.
 */
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { AgentSessionMode } from "../../../shared/ipc";
import {
  bashCommandEscapesCwd,
  cwdEscapeBashBlockReason,
  isReadonlyBashCommand,
  readonlyBashBlockReason,
} from "./bash-readonly";

export function shouldBlockReadonlyModeToolCall(
  mode: AgentSessionMode,
  toolName: string,
  allowedTools: readonly string[],
  toolInput?: Record<string, unknown>,
  cwd?: string | null,
): { block: boolean; reason?: string } {
  if (mode !== "ask" && mode !== "plan") return { block: false };

  if (toolName === "bash") {
    if (!allowedTools.includes("bash")) {
      return {
        block: true,
        reason:
          mode === "ask"
            ? "调研模式禁止调用工具「bash」。"
            : "Plan 模式禁止调用工具「bash」。",
      };
    }
    const command =
      typeof toolInput?.command === "string" ? toolInput.command : "";
    if (!isReadonlyBashCommand(command)) {
      return {
        block: true,
        reason: readonlyBashBlockReason(command || "(empty)"),
      };
    }
    if (cwd && bashCommandEscapesCwd(command, cwd)) {
      return { block: true, reason: cwdEscapeBashBlockReason(command) };
    }
    return { block: false };
  }

  if (allowedTools.includes(toolName)) return { block: false };
  if (mode === "ask") {
    return {
      block: true,
      reason: `调研模式禁止调用工具「${toolName}」。请使用只读研究（read/grep/find/ls/只读 bash），或切换到 Plan / Agent。`,
    };
  }
  return {
    block: true,
    reason: `Plan 模式禁止调用工具「${toolName}」。请使用只读研究（read/grep/find/ls/只读 bash）或 write_plan。`,
  };
}

/** Inline extension factory; getMode/getAllowedTools/getCwd read live SessionHost state. */
export function createPlanModeGuardExtension(opts: {
  getMode: () => AgentSessionMode;
  getAllowedTools: () => readonly string[];
  getCwd?: () => string | null;
}): InlineExtension {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      const input =
        event && typeof event === "object" && "input" in event
          ? (event.input as Record<string, unknown>)
          : undefined;
      const decision = shouldBlockReadonlyModeToolCall(
        opts.getMode(),
        event.toolName,
        opts.getAllowedTools(),
        input,
        opts.getCwd?.() ?? null,
      );
      if (decision.block) {
        return { block: true, reason: decision.reason };
      }
      return undefined;
    });
  };
}
