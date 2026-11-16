/** Read one branch-aware context estimate for both UI and maintenance, keeping request usage separate. */
import { estimateTokens, type AgentSession } from "@earendil-works/pi-coding-agent";
import { getCurrentTools, getToolStateChanges, toToolDeclaration } from "@earendil-works/pi-ai";
import type { TurnUsage } from "../../shared/ipc";
import { estimateTextTokens } from "./context-breakdown";
import { turnUsageFromMessage } from "./session-host-helpers";

type ContextSource = "usage" | "estimate" | "unknown";
type AnchorState = { id: string; signature: string; invalid: boolean };
const anchors = new WeakMap<AgentSession, AnchorState>();

export interface SessionContextState {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  source: ContextSource;
  toolSchemaTokens: number;
  lastTurn?: TurnUsage;
}

/** Estimate declarations independently from the human-readable tool descriptions. */
function toolSchemas(session: AgentSession): string {
  return JSON.stringify(session.agent.state.tools.map(toToolDeclaration));
}

/** Discard stale anchors after edits, summaries, model changes or pending prompt/tool changes. */
export function readSessionContext(session: AgentSession): SessionContextState {
  const sdk = session.getContextUsage();
  const model = session.routedModel?.model ?? session.model;
  const contextWindow = sdk?.contextWindow ?? model?.contextWindow ?? 0;
  const projection = session.sessionManager.buildSessionProjection();
  const branch = session.sessionManager.getBranch();
  const positions = new Map(branch.map((entry, index) => [entry.id, index]));
  const boundary = branch.findLastIndex((entry) => entry.type === "compaction" || entry.type === "context_edit" || entry.type === "model_change");
  let lastTurn: TurnUsage | undefined;
  let anchorId: string | undefined;
  let anchorMessages: readonly { role: string }[] = [];
  for (const entry of [...projection.entries].reverse()) {
    if ((positions.get(entry.sourceEntry.id) ?? -1) <= boundary) continue;
    for (const message of [...entry.messages].reverse()) {
      if (message.role !== "assistant") continue;
      if (model && (message.provider !== model.provider || message.model !== model.id)) continue;
      const usage = turnUsageFromMessage(message);
      if (!usage) continue;
      lastTurn = usage;
      anchorId = entry.sourceEntry.id;
      // Later pending system messages may already announce a new loadout, but
      // only declarations preceding this measured response belong to its usage.
      const anchorEntry = projection.entries.indexOf(entry);
      anchorMessages = [
        ...projection.entries.slice(0, anchorEntry).flatMap((item) => item.messages),
        ...entry.messages.slice(0, entry.messages.indexOf(message) + 1),
      ];
      break;
    }
    if (lastTurn) break;
  }

  const schemas = toolSchemas(session);
  const toolSchemaTokens = schemas === "[]" ? 0 : estimateTextTokens(schemas);
  const signature = JSON.stringify([model?.provider, model?.id, session.thinkingLevel, session.systemPrompt, schemas]);
  const previous = anchors.get(session);
  let invalid = false;
  if (anchorId) {
    const changes = getToolStateChanges(getCurrentTools(anchorMessages), session.agent.state.tools);
    invalid = changes.toolsAdded.length > 0 || changes.toolsRemoved.length > 0 ||
      (previous?.id === anchorId && (previous.invalid || previous.signature !== signature));
    anchors.set(session, { id: anchorId, signature, invalid });
  } else {
    anchors.delete(session);
  }

  let tokens: number | null = null;
  let source: ContextSource = "unknown";
  if (anchorId && !invalid && typeof sdk?.tokens === "number" && Number.isFinite(sdk.tokens)) {
    tokens = Math.max(0, sdk.tokens);
    source = "usage";
  } else if (model) {
    // No valid measured anchor: count the current prompt and declarations once.
    tokens = estimateTextTokens(session.systemPrompt) + toolSchemaTokens;
    for (const message of projection.messages) {
      if (message.role !== "system") tokens += estimateTokens(message);
    }
    source = "estimate";
    lastTurn = undefined;
  }
  return {
    tokens, contextWindow, source, toolSchemaTokens,
    percent: tokens !== null && contextWindow > 0 ? tokens / contextWindow * 100 : null,
    ...(lastTurn ? { lastTurn } : {}),
  };
}
