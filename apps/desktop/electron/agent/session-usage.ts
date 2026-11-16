/**
 * Usage-snapshot and compaction-delta bookkeeping extracted from session-host.ts.
 * These take the AgentSession explicitly rather than reaching into SessionHost state,
 * so they stay easy to reason about / test independently.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SessionUsageSnapshot } from "../../shared/ipc";
import { buildContextBreakdown } from "./context-breakdown";
import { modelUsageKey, recordTurnUsage } from "./usage-store";
import {
  estimateMessageTokens,
  estimateThinkingTokens,
  estimateToolHistoryTokens,
} from "./session-host-helpers";
import { readSessionContext } from "./session-context";

/** Read capacity from Pi's active context and request usage from its current branch. */
export function buildUsageSnapshot(
  session: AgentSession,
): SessionUsageSnapshot | null {
  try {
    const stats = session.getSessionStats();
    const ctx = readSessionContext(session);
    const lastTurnUsage = ctx.lastTurn;
    const contextWindow =
      ctx?.contextWindow ??
      (typeof session.model?.contextWindow === "number"
        ? session.model.contextWindow
        : 0);
    const context =
      contextWindow > 0
        ? buildContextBreakdown({
            systemPrompt: session.systemPrompt ?? "",
            contextWindow,
            // Same post-response estimate used by main-process maintenance.
            contextTokens: ctx.tokens,
            source: ctx.source,
            toolSchemaTokens: ctx.toolSchemaTokens,
            messageTokens: estimateMessageTokens(session),
            // Split toolCall args + toolResult bodies and assistant thinking
            // blocks out of the message total so the breakdown UI shows where
            // the prompt bytes actually live, instead of one 88% "overhead"
            // bucket that hides tool-history growth.
            toolHistoryTokens: estimateToolHistoryTokens(session),
            thinkingTokens: estimateThinkingTokens(session),
          })
        : null;
    return {
      tokens: {
        input: stats.tokens.input,
        output: stats.tokens.output,
        cacheRead: stats.tokens.cacheRead,
        cacheWrite: stats.tokens.cacheWrite,
        total: stats.tokens.total,
      },
      cost: stats.cost,
      context,
      ...(lastTurnUsage ? { lastTurn: lastTurnUsage } : {}),
      userMessages: stats.userMessages,
      assistantMessages: stats.assistantMessages,
      toolCalls: stats.toolCalls,
    };
  } catch {
    return null;
  }
}

export type CompactionStatsBaseline = {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  modelKey: string;
};

export function captureCompactionBaseline(
  session: AgentSession,
): CompactionStatsBaseline | null {
  try {
    const stats = session.getSessionStats();
    const model = session.model;
    return {
      tokens: {
        input: stats.tokens.input,
        output: stats.tokens.output,
        cacheRead: stats.tokens.cacheRead,
        cacheWrite: stats.tokens.cacheWrite,
        total: stats.tokens.total,
      },
      cost: stats.cost,
      modelKey: model ? modelUsageKey(model.provider, model.id) : "unknown/unknown",
    };
  } catch {
    return null;
  }
}

/** Records the token/cost delta since `baseline` to the daily usage store. */
export function recordCompactionDelta(
  session: AgentSession,
  baseline: CompactionStatsBaseline,
): void {
  try {
    const stats = session.getSessionStats();
    const tokens = {
      input: Math.max(0, stats.tokens.input - baseline.tokens.input),
      output: Math.max(0, stats.tokens.output - baseline.tokens.output),
      cacheRead: Math.max(
        0,
        stats.tokens.cacheRead - baseline.tokens.cacheRead,
      ),
      cacheWrite: Math.max(
        0,
        stats.tokens.cacheWrite - baseline.tokens.cacheWrite,
      ),
      total: Math.max(0, stats.tokens.total - baseline.tokens.total),
    };
    const costTotal = Math.max(0, stats.cost - baseline.cost);
    if (tokens.total <= 0 && costTotal <= 0) return;
    recordTurnUsage(baseline.modelKey, {
      tokens,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: costTotal,
      },
    }).catch(() => {
      /* ignore */
    });
  } catch {
    /* ignore */
  }
}
