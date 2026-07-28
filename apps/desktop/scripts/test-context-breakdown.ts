import {
  buildContextBreakdown,
  estimateTextTokens,
  splitSystemPrompt,
} from "../electron/agent/context-breakdown";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(estimateTextTokens("") === 0, "empty text → 0");
assert(estimateTextTokens("abcd") === 1, "4 chars → 1 token");
assert(estimateTextTokens("abcdefgh") === 2, "8 chars → 2 tokens");

const emptyParts = splitSystemPrompt("");
assert(emptyParts.system === "", "empty prompt system");
assert(emptyParts.project === "", "empty prompt project");
assert(emptyParts.skills === "", "empty prompt skills");
assert(emptyParts.tools === "", "empty prompt tools");

const sample = `You are an expert coding assistant.

Available tools:
- read: Read a file
- bash: Run a shell command

Guidelines:
- Be concise

<project_context>

Project-specific instructions and guidelines:

<project_instructions path="AGENTS.md">
Do the thing
</project_instructions>

</project_context>
<available_skills>
  <skill>
    <name>demo</name>
    <description>Demo skill</description>
    <location>/tmp/SKILL.md</location>
  </skill>
</available_skills>
Current working directory: /tmp/proj`;

const parts = splitSystemPrompt(sample);
assert(parts.tools.includes("Available tools:"), "tools section extracted");
assert(parts.tools.includes("- read:"), "tools list kept");
assert(!parts.tools.includes("Guidelines:"), "guidelines not in tools");
assert(parts.project.includes("<project_context>"), "project extracted");
assert(parts.skills.includes("<available_skills>"), "skills extracted");
assert(parts.system.includes("expert coding"), "base system kept");
assert(!parts.system.includes("<project_context>"), "project removed from system");
assert(!parts.system.includes("<available_skills>"), "skills removed from system");
assert(!parts.system.includes("Available tools:"), "tools removed from system");

function segmentSum(
  segments: Array<{ id: string; tokens: number }>,
): number {
  return segments.reduce((s, seg) => s + seg.tokens, 0);
}

function byId(
  segments: Array<{ id: string; tokens: number }>,
): Record<string, number> {
  return Object.fromEntries(segments.map((s) => [s.id, s.tokens]));
}

// Under-estimate: content stays raw; residual → overhead (not scaled into system)
const under = buildContextBreakdown({
  systemPrompt: sample,
  contextWindow: 100_000,
  contextTokens: 12_000,
  messageTokens: 100,
});
assert(under.estimated === true, "marked estimated");
assert(under.tokens === 12_000, "tokens");
assert(segmentSum(under.segments) === 12_000, "under: segments sum to API total");
const underMap = byId(under.segments);
assert(underMap.messages === 100, "under: messages stay at raw estimate");
assert((underMap.overhead ?? 0) > 0, "under: overhead absorbs residual");
assert(
  (underMap.system ?? 0) +
    (underMap.project ?? 0) +
    (underMap.skills ?? 0) +
    (underMap.tools ?? 0) +
    (underMap.messages ?? 0) +
    (underMap.overhead ?? 0) ===
    12_000,
  "under: content + overhead = API total",
);
assert(
  (underMap.system ?? 0) < 2000,
  "under: system not inflated toward API total",
);

// Over-estimate: scale content down, no overhead
const over = buildContextBreakdown({
  systemPrompt: "x".repeat(4000),
  contextWindow: 128_000,
  contextTokens: 100,
  messageTokens: 500,
});
assert(segmentSum(over.segments) === 100, "over: segments sum to 100");
assert(
  !over.segments.some((s) => s.id === "overhead" && s.tokens > 0),
  "over: no overhead when scaled down",
);

// Unknown contextTokens: keep raw estimates, no overhead
const unknown = buildContextBreakdown({
  systemPrompt: sample,
  contextWindow: 128_000,
  contextTokens: null,
  messageTokens: 100,
});
assert(unknown.tokens === null, "unknown tokens");
assert(unknown.percent === null, "unknown percent");
assert(
  unknown.segments.find((s) => s.id === "messages")?.tokens === 100,
  "messages kept when context unknown",
);
assert(
  !unknown.segments.some((s) => s.id === "overhead"),
  "no overhead without contextTokens",
);

// Empty estimates with known total → all overhead
const emptyEst = buildContextBreakdown({
  systemPrompt: "",
  contextWindow: 1000,
  contextTokens: 50,
  messageTokens: 0,
});
assert(segmentSum(emptyEst.segments) === 50, "empty est fills total");
assert(
  emptyEst.segments.find((s) => s.id === "overhead")?.tokens === 50,
  "empty est → overhead",
);
assert(
  (emptyEst.segments.find((s) => s.id === "system")?.tokens ?? 0) === 0,
  "empty est does not inflate system",
);

const noTags = buildContextBreakdown({
  systemPrompt: "Just a short system prompt.",
  contextWindow: 1000,
  contextTokens: 50,
  messageTokens: 10,
});
assert(segmentSum(noTags.segments) === 50, "noTags sums to 50");
assert(
  (noTags.segments.find((s) => s.id === "system")?.tokens ?? 0) > 0,
  "untagged text goes to system",
);
assert(
  (noTags.segments.find((s) => s.id === "overhead")?.tokens ?? 0) > 0,
  "noTags residual → overhead",
);

console.log("test-context-breakdown: ok");
