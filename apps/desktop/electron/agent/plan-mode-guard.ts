/**
 * Ask/Plan hard gate: block non-allowlisted tools via Pi tool_call extension.
 */
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { AgentSessionMode } from "../../shared/ipc";

export function shouldBlockReadonlyModeToolCall(
  mode: AgentSessionMode,
  toolName: string,
  allowedTools: readonly string[],
): { block: boolean; reason?: string } {
  if (mode !== "ask" && mode !== "plan") return { block: false };
  if (allowedTools.includes(toolName)) return { block: false };
  if (mode === "ask") {
    return {
      block: true,
      reason: `调研模式禁止调用工具「${toolName}」。请使用只读研究（read/grep/find/ls），或切换到 Plan / Agent。`,
    };
  }
  return {
    block: true,
    reason: `Plan 模式禁止调用工具「${toolName}」。请使用只读研究（read/grep/find/ls）或 write_plan。`,
  };
}

/** @deprecated Prefer shouldBlockReadonlyModeToolCall */
export const shouldBlockPlanToolCall = shouldBlockReadonlyModeToolCall;

/** Inline extension factory; getMode/getAllowedTools read live SessionHost state. */
export function createPlanModeGuardExtension(opts: {
  getMode: () => AgentSessionMode;
  getAllowedTools: () => readonly string[];
}): InlineExtension {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      const decision = shouldBlockReadonlyModeToolCall(
        opts.getMode(),
        event.toolName,
        opts.getAllowedTools(),
      );
      if (decision.block) {
        return { block: true, reason: decision.reason };
      }
      return undefined;
    });
  };
}
