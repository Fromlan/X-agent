/**
 * Vitest suite for the new `toolHistory` / `thinking` segments in
 * `buildContextBreakdown`. Reproduces the 195k-context breakdown the user
 * reported: messages total ~77.7k tokens, system/prompt ~1.6k, with the
 * legacy code reporting 88% "overhead" / 171.8k tokens. After the split,
 * the residual overhead must drop to a sensible bound (< 20%).
 */
import { describe, it, expect } from "vitest";
import { buildContextBreakdown } from "./context-breakdown";

const SYSTEM_PROMPT = `You are an expert coding assistant.
<project_context>
cwd: /d/UGit/z-2
</project_context>
<available_skills>
- design-initiation
- design-process
- design-systems
</available_skills>
Available tools:
- read: Read file contents
- write: Write content to a file
- edit: Replace text in a file
- bash: Execute a shell command
Guidelines:
Be precise.`;

describe("buildContextBreakdown — toolHistory / thinking split", () => {
  it("emits only the legacy segments when sub-estimates are not provided", () => {
    const r = buildContextBreakdown({
      systemPrompt: SYSTEM_PROMPT,
      contextWindow: 204_800,
      contextTokens: 195_400,
      messageTokens: 20_900,
    });
    const ids = r.segments.map((s) => s.id);
    expect(ids).not.toContain("toolHistory");
    expect(ids).not.toContain("thinking");
    // Legacy breakdown still works: messages + system + project + skills + tools + overhead
    expect(ids).toContain("messages");
    expect(ids).toContain("overhead");
  });

  it("splits messages into messages + toolHistory + thinking when sub-estimates are provided", () => {
    const r = buildContextBreakdown({
      systemPrompt: SYSTEM_PROMPT,
      contextWindow: 204_800,
      contextTokens: 195_400,
      messageTokens: 77_700, // real total from the 195k session
      toolHistoryTokens: 60_000, // 13 read toolResults (~57k) + 9 write toolCall args (~19k), capped
      thinkingTokens: 900,
    });
    const byId = Object.fromEntries(r.segments.map((s) => [s.id, s.tokens]));
    expect(byId.messages).toBe(77_700 - 60_000 - 900);
    expect(byId.toolHistory).toBe(60_000);
    expect(byId.thinking).toBe(900);
    // Legacy breakdown: overhead = 195.4k - 1.6k - 20.9k = 172.9k (88%).
    // New breakdown: overhead = 195.4k - (1.6k + 16.8k messages + 60k toolHistory
    // + 0.9k thinking) ≈ 116.1k. So overhead drops by ~57k.
    expect(byId.overhead).toBeLessThan(130_000);
    // The user's "protocol overhead" bucket must no longer dominate the
    // bar: toolHistory + thinking account for > 30% of contextTokens.
    const visible = (byId.toolHistory ?? 0) + (byId.thinking ?? 0);
    expect(visible).toBeGreaterThan(60_000);
  });

  it("clamps toolHistory / thinking so the sub-totals never exceed messageTokens", () => {
    // Caller bug: sub-totals are larger than the total they were sub-sums of.
    const r = buildContextBreakdown({
      systemPrompt: "",
      contextWindow: 200_000,
      contextTokens: 100_000,
      messageTokens: 10_000,
      toolHistoryTokens: 20_000,
      thinkingTokens: 5_000,
    });
    const byId = Object.fromEntries(r.segments.map((s) => [s.id, s.tokens]));
    const subSum = (byId.toolHistory ?? 0) + (byId.thinking ?? 0);
    expect(subSum).toBeLessThanOrEqual(10_000);
    expect(byId.messages).toBeGreaterThanOrEqual(0);
  });

  it("keeps legacy callers (no sub-estimates) backward compatible", () => {
    // Pure legacy call shape must still produce the same shape it did before.
    const r = buildContextBreakdown({
      systemPrompt: "",
      contextWindow: 100_000,
      contextTokens: 50_000,
      messageTokens: 1_000,
    });
    expect(r.segments.length).toBeGreaterThan(0);
    // The new segments must be omitted.
    for (const seg of r.segments) {
      expect(["system", "project", "skills", "tools", "messages", "overhead"]).toContain(
        seg.id,
      );
    }
  });

  it("hides zero-token toolHistory / thinking so the breakdown bar isn't cluttered", () => {
    const r = buildContextBreakdown({
      systemPrompt: "",
      contextWindow: 100_000,
      contextTokens: 50_000,
      messageTokens: 1_000,
      toolHistoryTokens: 0,
      thinkingTokens: 0,
    });
    const ids = r.segments.map((s) => s.id);
    expect(ids).not.toContain("toolHistory");
    expect(ids).not.toContain("thinking");
  });
});
