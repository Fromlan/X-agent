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
import { TRANSCRIPT_CAPS, truncateSerialized } from "../../shared/transcript";

export const TOOL_DETAIL_MAX_CHARS = TRANSCRIPT_CAPS.toolDetail;

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
  return truncateSerialized(value, TOOL_DETAIL_MAX_CHARS);
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

/**
 * Sum of chars/4 across assistant toolCall arguments and toolResult content
 * bodies. Mirrors Pi's `estimateTokens` heuristic so the breakdown segments
 * add up to the same total as `estimateMessageTokens`.
 *
 * Used by `context-breakdown` to break "messages" into a `toolHistory` segment
 * + a smaller `messages` segment (user + assistant prose only).
 */
export function estimateToolHistoryTokens(session: AgentSession): number {
  try {
    const messages = session.messages ?? [];
    let totalChars = 0;
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const m = msg as {
        role?: string;
        content?: unknown;
      };
      if (m.role === "assistant") {
        // content is an array of blocks; collect {toolCall}.name + JSON(args)
        if (Array.isArray(m.content)) {
          for (const block of m.content) {
            if (
              block &&
              typeof block === "object" &&
              (block as { type?: string }).type === "toolCall"
            ) {
              const b = block as {
                name?: unknown;
                arguments?: unknown;
              };
              const nameLen =
                typeof b.name === "string" ? b.name.length : 0;
              const argsLen = jsonStringifyLen(b.arguments);
              totalChars += nameLen + argsLen;
            }
          }
        }
      } else if (m.role === "toolResult") {
        if (typeof m.content === "string") {
          totalChars += m.content.length;
        } else if (Array.isArray(m.content)) {
          for (const block of m.content) {
            if (
              block &&
              typeof block === "object" &&
              typeof (block as { text?: unknown }).text === "string"
            ) {
              totalChars += (block as { text: string }).text.length;
            }
          }
        }
      }
    }
    return Math.ceil(totalChars / 4);
  } catch {
    return 0;
  }
}

/**
 * Sum of chars/4 across assistant `thinking` blocks. Companion to
 * `estimateToolHistoryTokens` for the context breakdown.
 */
export function estimateThinkingTokens(session: AgentSession): number {
  try {
    const messages = session.messages ?? [];
    let totalChars = 0;
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const m = msg as { role?: string; content?: unknown };
      if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
      for (const block of m.content) {
        if (
          block &&
          typeof block === "object" &&
          (block as { type?: string }).type === "thinking" &&
          typeof (block as { thinking?: unknown }).thinking === "string"
        ) {
          totalChars += (block as { thinking: string }).thinking.length;
        }
      }
    }
    return Math.ceil(totalChars / 4);
  } catch {
    return 0;
  }
}

/** Best-effort `JSON.stringify` length; safe against circular refs. */
function jsonStringifyLen(value: unknown): number {
  if (value === undefined) return 0;
  try {
    return JSON.stringify(value).length;
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
    sessionType: "code",
    error,
  };
}
