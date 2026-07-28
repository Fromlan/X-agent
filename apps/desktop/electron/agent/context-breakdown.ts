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

const SEGMENT_LABELS: Record<ContextSegmentId, string> = {
  system: "系统提示",
  project: "项目上下文",
  skills: "技能索引",
  tools: "工具说明",
  messages: "对话消息",
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
};

type ContentParts = {
  system: number;
  project: number;
  skills: number;
  tools: number;
  messages: number;
};

/** Scale content segments down so they sum to `total` (rounding → largest). */
function scaleContentDown(parts: ContentParts, total: number): ContentParts {
  const accounted =
    parts.system + parts.project + parts.skills + parts.tools + parts.messages;
  if (total <= 0 || accounted <= 0) {
    return { system: 0, project: 0, skills: 0, tools: 0, messages: 0 };
  }
  const scale = total / accounted;
  let system = Math.round(parts.system * scale);
  let project = Math.round(parts.project * scale);
  let skills = Math.round(parts.skills * scale);
  let tools = Math.round(parts.tools * scale);
  let messages = Math.round(parts.messages * scale);
  const sum = system + project + skills + tools + messages;
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
      ] as Array<{ key: SegKey; value: number }>
    ).sort((a, b) => b.value - a.value);
    const target = ranked[0]!.key;
    if (target === "system") system = Math.max(0, system + drift);
    else if (target === "project") project = Math.max(0, project + drift);
    else if (target === "skills") skills = Math.max(0, skills + drift);
    else if (target === "tools") tools = Math.max(0, tools + drift);
    else messages = Math.max(0, messages + drift);
  }
  return { system, project, skills, tools, messages };
}

/**
 * Build a UI-facing context breakdown.
 *
 * Content segments stay at text estimates (chars/4 + message estimate).
 * When API `contextTokens` exceeds that sum, the residual is `overhead`
 * (tool JSON schemas + request framing) — never folded into system.
 * If estimates overshoot the API total, content is scaled down and overhead is 0.
 */
export function buildContextBreakdown(
  input: BuildContextBreakdownInput,
): ContextBreakdown {
  const parts = splitSystemPrompt(input.systemPrompt);
  let systemTokens = estimateTextTokens(parts.system);
  let projectTokens = estimateTextTokens(parts.project);
  let skillsTokens = estimateTextTokens(parts.skills);
  let toolsTokens = estimateTextTokens(parts.tools);
  let messagesTokens = Math.max(0, Math.round(input.messageTokens ?? 0));
  let overheadTokens = 0;

  const contextWindow = Math.max(0, input.contextWindow);
  const tokens = input.contextTokens;

  if (tokens != null) {
    let accounted =
      systemTokens +
      projectTokens +
      skillsTokens +
      toolsTokens +
      messagesTokens;

    if (accounted > tokens && accounted > 0) {
      const scaled = scaleContentDown(
        {
          system: systemTokens,
          project: projectTokens,
          skills: skillsTokens,
          tools: toolsTokens,
          messages: messagesTokens,
        },
        tokens,
      );
      systemTokens = scaled.system;
      projectTokens = scaled.project;
      skillsTokens = scaled.skills;
      toolsTokens = scaled.tools;
      messagesTokens = scaled.messages;
      overheadTokens = 0;
    } else {
      // Keep content estimates as-is; residual is protocol/tool-schema overhead.
      overheadTokens = Math.max(0, tokens - accounted);
    }
  }

  const segments: ContextSegment[] = (
    [
      ["system", systemTokens],
      ["project", projectTokens],
      ["skills", skillsTokens],
      ["tools", toolsTokens],
      ["messages", messagesTokens],
      ["overhead", overheadTokens],
    ] as const
  )
    .filter(([id, segTokens]) => id !== "overhead" || segTokens > 0)
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
