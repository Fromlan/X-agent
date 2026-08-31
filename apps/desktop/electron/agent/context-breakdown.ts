import type {
  ContextBreakdown,
  ContextSegment,
  ContextSegmentId,
} from "../../shared/ipc";

/** Match Pi compaction heuristic: ~4 chars per token. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Prompt-side context from a turn's usage (excludes assistant output).
 * Prefer this over usage.totalTokens for the right-panel occupancy bar.
 */
export function promptTokensFromTurnUsage(usage: {
  input: number;
  cacheRead: number;
}): number {
  return Math.max(
    0,
    Math.round(Number(usage.input) || 0) +
      Math.round(Number(usage.cacheRead) || 0),
  );
}

const SEGMENT_LABELS: Record<ContextSegmentId, string> = {
  system: "系统提示",
  project: "项目上下文",
  skills: "技能索引",
  tools: "工具说明",
  messages: "对话消息",
  toolHistory: "工具历史",
  thinking: "思考块",
  overhead: "协议损耗",
};

export type SystemPromptParts = {
  system: string;
  project: string;
  skills: string;
  tools: string;
};

/**
 * Heuristically split a Pi-built system prompt into segments.
 * Markers: `<project_context>`, `<available_skills>`, and the
 * `Available tools:` block (default prompt) or leftover base text.
 */
export function splitSystemPrompt(systemPrompt: string): SystemPromptParts {
  let rest = systemPrompt ?? "";
  let project = "";
  let skills = "";
  let tools = "";

  const projectMatch = rest.match(
    /<project_context>[\s\S]*?<\/project_context>\n?/,
  );
  if (projectMatch && projectMatch.index != null) {
    project = projectMatch[0];
    rest =
      rest.slice(0, projectMatch.index) +
      rest.slice(projectMatch.index + projectMatch[0].length);
  }

  const skillsMatch = rest.match(
    /<available_skills>[\s\S]*?<\/available_skills>\n?/,
  );
  if (skillsMatch && skillsMatch.index != null) {
    skills = skillsMatch[0];
    rest =
      rest.slice(0, skillsMatch.index) +
      rest.slice(skillsMatch.index + skillsMatch[0].length);
  }

  // Default Pi prompt puts tools near the top as "Available tools:\n..."
  const toolsHeader = /Available tools:\n/;
  const toolsHeaderMatch = rest.match(toolsHeader);
  if (toolsHeaderMatch && toolsHeaderMatch.index != null) {
    const start = toolsHeaderMatch.index;
    const after = rest.slice(start);
    const endMatch = after.match(
      /\n(?:Guidelines:|In addition to the tools above|[A-Z][^\n]{0,40}:\n)/,
    );
    if (endMatch && endMatch.index != null && endMatch.index > 0) {
      tools = after.slice(0, endMatch.index);
      rest = rest.slice(0, start) + after.slice(endMatch.index);
    } else {
      const para = after.match(/^Available tools:\n[\s\S]*?(?:\n\n|$)/);
      tools = para ? para[0] : after.slice(0, Math.min(after.length, 2000));
      rest = rest.slice(0, start) + after.slice(tools.length);
    }
  }

  return {
    system: rest,
    project,
    skills,
    tools,
  };
}

export type BuildContextBreakdownInput = {
  systemPrompt: string;
  contextWindow: number;
  /** From getContextUsage().tokens — full prompt context, or null. */
  contextTokens: number | null;
  /**
   * Independent estimate of conversation messages (user/assistant/toolResult…).
   * Prefer summing Pi estimateTokens(message) over residual math.
   */
  messageTokens?: number;
  /**
   * Sub-estimate of the assistant `toolCall` arguments + toolResult bodies
   * portion of `messageTokens`. When supplied, the breakdown shows a separate
   * `toolHistory` segment and the `messages` segment is reduced accordingly.
   */
  toolHistoryTokens?: number;
  /**
   * Sub-estimate of the assistant `thinking` blocks portion of
   * `messageTokens`. Shown as a separate `thinking` segment when present.
   */
  thinkingTokens?: number;
};

type ContentParts = {
  system: number;
  project: number;
  skills: number;
  tools: number;
  messages: number;
  toolHistory: number;
  thinking: number;
};

/** Scale content segments down so they sum to `total` (rounding → largest). */
function scaleContentDown(parts: ContentParts, total: number): ContentParts {
  const accounted =
    parts.system +
    parts.project +
    parts.skills +
    parts.tools +
    parts.messages +
    parts.toolHistory +
    parts.thinking;
  if (total <= 0 || accounted <= 0) {
    return {
      system: 0,
      project: 0,
      skills: 0,
      tools: 0,
      messages: 0,
      toolHistory: 0,
      thinking: 0,
    };
  }
  const scale = total / accounted;
  let system = Math.round(parts.system * scale);
  let project = Math.round(parts.project * scale);
  let skills = Math.round(parts.skills * scale);
  let tools = Math.round(parts.tools * scale);
  let messages = Math.round(parts.messages * scale);
  let toolHistory = Math.round(parts.toolHistory * scale);
  let thinking = Math.round(parts.thinking * scale);
  const sum = system + project + skills + tools + messages + toolHistory + thinking;
  const drift = total - sum;
  if (drift !== 0) {
    type SegKey = keyof ContentParts;
    const ranked: Array<{ key: SegKey; value: number }> = (
      [
        { key: "system", value: system },
        { key: "project", value: project },
        { key: "skills", value: skills },
        { key: "tools", value: tools },
        { key: "messages", value: messages },
        { key: "toolHistory", value: toolHistory },
        { key: "thinking", value: thinking },
      ] as Array<{ key: SegKey; value: number }>
    ).sort((a, b) => b.value - a.value);
    const target = ranked[0]!.key;
    if (target === "system") system = Math.max(0, system + drift);
    else if (target === "project") project = Math.max(0, project + drift);
    else if (target === "skills") skills = Math.max(0, skills + drift);
    else if (target === "tools") tools = Math.max(0, tools + drift);
    else if (target === "messages") messages = Math.max(0, messages + drift);
    else if (target === "toolHistory") toolHistory = Math.max(0, toolHistory + drift);
    else thinking = Math.max(0, thinking + drift);
  }
  return { system, project, skills, tools, messages, toolHistory, thinking };
}

/**
 * Build a UI-facing context breakdown.
 *
 * Content segments stay at text estimates (chars/4 + message estimate).
 * When API `contextTokens` exceeds that sum, the residual is `overhead`
 * (tool JSON schemas + request framing) — never folded into system.
 * If estimates overshoot the API total, content is scaled down and overhead is 0.
 *
 * When `toolHistoryTokens` / `thinkingTokens` are provided, the
 * `messageTokens` total is split into a `messages` segment (prose only) and
 * dedicated `toolHistory` / `thinking` segments. The split assumes the
 * sub-estimates are sub-counts of `messageTokens`; if they exceed it, the
 * surplus stays as `messages` (the prose floor cannot go below zero).
 */
export function buildContextBreakdown(
  input: BuildContextBreakdownInput,
): ContextBreakdown {
  const parts = splitSystemPrompt(input.systemPrompt);
  let systemTokens = estimateTextTokens(parts.system);
  let projectTokens = estimateTextTokens(parts.project);
  let skillsTokens = estimateTextTokens(parts.skills);
  let toolsTokens = estimateTextTokens(parts.tools);
  let messagesTotal = Math.max(0, Math.round(input.messageTokens ?? 0));
  const toolHistoryRaw = Math.max(
    0,
    Math.round(input.toolHistoryTokens ?? 0),
  );
  const thinkingRaw = Math.max(0, Math.round(input.thinkingTokens ?? 0));
  // Sub-counts off the prose total. Clamp so the sum cannot exceed messages.
  const subTotal = Math.min(toolHistoryRaw + thinkingRaw, messagesTotal);
  let toolHistoryTokens =
    messagesTotal > 0 ? Math.min(toolHistoryRaw, subTotal) : 0;
  let thinkingTokens =
    messagesTotal > 0
      ? Math.min(thinkingRaw, Math.max(0, subTotal - toolHistoryTokens))
      : 0;
  let messagesTokens = Math.max(0, messagesTotal - toolHistoryTokens - thinkingTokens);
  let overheadTokens = 0;

  const contextWindow = Math.max(0, input.contextWindow);
  const tokens = input.contextTokens;

  if (tokens != null) {
    let accounted =
      systemTokens +
      projectTokens +
      skillsTokens +
      toolsTokens +
      messagesTokens +
      toolHistoryTokens +
      thinkingTokens;

    if (accounted > tokens && accounted > 0) {
      const scaled = scaleContentDown(
        {
          system: systemTokens,
          project: projectTokens,
          skills: skillsTokens,
          tools: toolsTokens,
          messages: messagesTokens,
          toolHistory: toolHistoryTokens,
          thinking: thinkingTokens,
        },
        tokens,
      );
      systemTokens = scaled.system;
      projectTokens = scaled.project;
      skillsTokens = scaled.skills;
      toolsTokens = scaled.tools;
      messagesTokens = scaled.messages;
      toolHistoryTokens = scaled.toolHistory;
      thinkingTokens = scaled.thinking;
      overheadTokens = 0;
    } else {
      // Keep content estimates as-is; residual is protocol/tool-schema overhead.
      overheadTokens = Math.max(0, tokens - accounted);
    }
  }

  // `id` is typed as the literal union of segment ids; widen to ContextSegmentId
  // before filtering so the comparator branches type-check.
  const rawSegments: Array<[ContextSegmentId, number]> = [
    ["system", systemTokens],
    ["project", projectTokens],
    ["skills", skillsTokens],
    ["tools", toolsTokens],
    ["messages", messagesTokens],
    ["toolHistory", toolHistoryTokens],
    ["thinking", thinkingTokens],
    ["overhead", overheadTokens],
  ];
  const segments: ContextSegment[] = rawSegments
    .filter(([id, segTokens]) => {
      if (id === "overhead" && segTokens <= 0) return false;
      // Hide the new segments entirely when the caller didn't provide them
      // (preserves backward compatibility with tests / direct callers).
      if (id === "toolHistory" && input.toolHistoryTokens === undefined) return false;
      if (id === "thinking" && input.thinkingTokens === undefined) return false;
      // Hide zero-token toolHistory / thinking so the bar isn't cluttered.
      if ((id === "toolHistory" || id === "thinking") && segTokens <= 0) return false;
      return true;
    })
    .map(([id, segTokens]) => ({
      id,
      label: SEGMENT_LABELS[id],
      tokens: segTokens,
    }));

  const percent =
    tokens != null && contextWindow > 0
      ? Math.min(100, (tokens / contextWindow) * 100)
      : null;

  return {
    contextWindow,
    tokens,
    percent,
    segments,
    estimated: true,
  };
}
