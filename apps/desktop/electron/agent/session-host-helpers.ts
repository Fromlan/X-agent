/**
 * Pure / small helper functions extracted from session-host.ts.
 * These carry no state and only depend on their explicit arguments,
 * so they can be unit-tested in isolation (see scripts/test-session-host-helpers.ts).
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import type {
  ModelInfo,
  OpenProjectResult,
  SessionUsageSnapshot,
  TurnUsage,
} from "../../shared/ipc";

export const TOOL_DETAIL_MAX_CHARS = 256 * 1024;

export type ToolDetailRecord = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  done: boolean;
  truncated?: boolean;
};

export function serializeForDetail(
  value: unknown,
): { value: unknown; truncated: boolean } {
  try {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (!text) return { value, truncated: false };
    if (text.length <= TOOL_DETAIL_MAX_CHARS) {
      return { value, truncated: false };
    }
    return {
      value: `${text.slice(0, TOOL_DETAIL_MAX_CHARS)}\n…(截断 ${text.length - TOOL_DETAIL_MAX_CHARS} 字符)`,
      truncated: true,
    };
  } catch {
    return { value: String(value), truncated: false };
  }
}

export function modelFromSession(session: AgentSession): ModelInfo | null {
  const model = session.model;
  if (!model) return null;
  return {
    provider: model.provider,
    id: model.id,
    name: (model as { name?: string }).name ?? model.id,
    contextWindow:
      typeof model.contextWindow === "number" && model.contextWindow > 0
        ? model.contextWindow
        : undefined,
  };
}

export function turnUsageFromMessage(message: unknown): TurnUsage | null {
  if (!message || typeof message !== "object") return null;
  const msg = message as {
    usage?: Record<string, unknown>;
    stopReason?: string;
  };
  if (msg.stopReason === "aborted" || msg.stopReason === "error") {
    return null;
  }
  const usage = msg.usage;
  if (!usage || typeof usage !== "object") return null;
  const input = Number(usage.input) || 0;
  const output = Number(usage.output) || 0;
  const cacheRead = Number(usage.cacheRead) || 0;
  const cacheWrite = Number(usage.cacheWrite) || 0;
  const totalTokens =
    Number(usage.totalTokens) || input + output + cacheRead + cacheWrite;
  if (totalTokens <= 0 && input + output + cacheRead + cacheWrite <= 0) {
    return null;
  }
  const costRaw = usage.cost as Record<string, unknown> | undefined;
  const costInput = Number(costRaw?.input) || 0;
  const costOutput = Number(costRaw?.output) || 0;
  const costCacheRead = Number(costRaw?.cacheRead) || 0;
  const costCacheWrite = Number(costRaw?.cacheWrite) || 0;
  const costParts = costInput + costOutput + costCacheRead + costCacheWrite;
  const costTotal = Number(costRaw?.total) || costParts;
  return {
    tokens: {
      input,
      output,
      cacheRead,
      cacheWrite,
      total: totalTokens,
    },
    cost: {
      input: costInput,
      output: costOutput,
      cacheRead: costCacheRead,
      cacheWrite: costCacheWrite,
      total: costTotal,
    },
  };
}

export function emptyUsageSnapshot(): SessionUsageSnapshot {
  return {
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
    cost: 0,
    context: null,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
  };
}

/** Sum Pi chars/4 estimates across current in-memory conversation messages. */
export function estimateMessageTokens(session: AgentSession): number {
  try {
    const messages = session.messages ?? [];
    let total = 0;
    for (const message of messages) {
      try {
        total += estimateTokens(message);
      } catch {
        /* skip unestimable message shapes */
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Tokens for messages after the last assistant turn.
 * Needed when a toolResult lands before the next assistant usage arrives.
 */
export function estimateTrailingAfterLastAssistant(
  session: AgentSession,
): number {
  try {
    const messages = session.messages ?? [];
    let lastAssistant = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const role = (messages[i] as { role?: string } | undefined)?.role;
      if (role === "assistant") {
        lastAssistant = i;
        break;
      }
    }
    if (lastAssistant < 0 || lastAssistant >= messages.length - 1) return 0;
    let total = 0;
    for (let i = lastAssistant + 1; i < messages.length; i++) {
      try {
        total += estimateTokens(messages[i]);
      } catch {
        /* skip unestimable message shapes */
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export function failOpen(error: string, cwd = ""): OpenProjectResult {
  return {
    ok: false,
    cwd,
    sessionId: "",
    model: null,
    thinkingLevel: "off",
    error,
  };
}
