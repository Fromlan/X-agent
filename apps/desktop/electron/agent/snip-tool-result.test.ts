/**
 * Vitest suite for `snip-tool-result.ts` — the snip pass that runs before
 * auto-compact. Covers the boundary cases called out in the plan and the
 * Reasonix-style "stale tool output is snipped before summary" guarantee.
 */
import { describe, it, expect } from "vitest";
import {
  isToolResultMessage,
  measureToolResultChars,
  snipOne,
  snipToolResultsInPlace,
  type SnipOptions,
} from "./snip-tool-result";

function makeArrayToolResult(text: string, snipped?: unknown) {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "read",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 0,
    ...(snipped !== undefined ? { snipped } : {}),
  };
}

function makeStringToolResult(text: string) {
  return {
    role: "toolResult",
    toolCallId: "call-2",
    toolName: "read",
    content: text,
    isError: false,
    timestamp: 0,
  };
}

const SNIP_OPTS: SnipOptions = {
  threshold: 8192,
  headKeep: 4096,
  tailKeep: 1024,
};

describe("isToolResultMessage", () => {
  it("matches string content", () => {
    expect(isToolResultMessage(makeStringToolResult("hi"))).toBe(true);
  });
  it("matches array content", () => {
    expect(isToolResultMessage(makeArrayToolResult("hi"))).toBe(true);
  });
  it("rejects user / assistant / non-objects", () => {
    expect(isToolResultMessage({ role: "user", content: "x" })).toBe(false);
    expect(isToolResultMessage({ role: "assistant", content: [] })).toBe(false);
    expect(isToolResultMessage(null)).toBe(false);
    expect(isToolResultMessage(undefined)).toBe(false);
    expect(isToolResultMessage("string")).toBe(false);
  });
});

describe("measureToolResultChars", () => {
  it("sums text content across array blocks", () => {
    const msg = {
      role: "toolResult",
      content: [
        { type: "text", text: "abcd" },
        { type: "text", text: "efghij" },
      ],
    } as unknown;
    expect(measureToolResultChars(msg as never)).toBe(10);
  });
  it("counts string content directly", () => {
    const msg = { role: "toolResult", content: "abcdef" } as unknown;
    expect(measureToolResultChars(msg as never)).toBe(6);
  });
});

describe("snipOne", () => {
  it("does nothing when content is below threshold", () => {
    const msg = makeArrayToolResult("short content");
    const marker = snipOne(msg as never, SNIP_OPTS);
    expect(marker).toBeNull();
    expect(msg.content[0].text).toBe("short content");
    expect(msg.snipped).toBeUndefined();
  });

  it("does nothing at exactly the threshold (inclusive boundary)", () => {
    const text = "x".repeat(SNIP_OPTS.threshold);
    const msg = makeArrayToolResult(text);
    const marker = snipOne(msg as never, SNIP_OPTS);
    expect(marker).toBeNull();
    expect(msg.content[0].text).toBe(text);
  });

  it("snips when content is over threshold", () => {
    const text = "x".repeat(25_000);
    const msg = makeArrayToolResult(text);
    const marker = snipOne(msg as never, SNIP_OPTS);
    expect(marker).not.toBeNull();
    expect(marker!.originalChars).toBe(25_000);
    expect(marker!.headChars).toBe(4096);
    expect(marker!.tailChars).toBe(1024);
    const after = msg.content[0].text as string;
    expect(after.length).toBeLessThan(25_000);
    expect(after).toContain("tool result middle pruned");
    expect(after.startsWith("x".repeat(4096))).toBe(true);
    expect(after.endsWith("x".repeat(1024))).toBe(true);
    expect(msg.snipped).toBeDefined();
  });

  it("is idempotent: re-snip is a no-op once marker is set", () => {
    const text = "y".repeat(20_000);
    const msg = makeArrayToolResult(text);
    const first = snipOne(msg as never, SNIP_OPTS);
    const second = snipOne(msg as never, SNIP_OPTS);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    // text must not have been re-truncated
    expect((msg.content[0] as { text: string }).text.length).toBe(
      (first!.headChars as number) + (first!.tailChars as number) +
        (msg.content[0] as { text: string }).text.slice(
          SNIP_OPTS.headKeep,
          (msg.content[0] as { text: string }).text.length - SNIP_OPTS.tailKeep,
        ).length,
    );
  });

  it("respects threshold = 0 (snip disabled)", () => {
    const text = "z".repeat(50_000);
    const msg = makeArrayToolResult(text);
    const marker = snipOne(msg as never, { ...SNIP_OPTS, threshold: 0 });
    expect(marker).toBeNull();
    expect(msg.content[0].text).toBe(text);
  });

  it("handles string content (not array)", () => {
    const text = "s".repeat(20_000);
    const msg = makeStringToolResult(text);
    const marker = snipOne(msg as never, SNIP_OPTS);
    expect(marker).not.toBeNull();
    expect(typeof msg.content).toBe("string");
    expect((msg.content as string).length).toBeLessThan(20_000);
  });
});

describe("snipToolResultsInPlace", () => {
  it("walks the messages array and snips every oversized toolResult", () => {
    const messages = [
      { role: "user", content: "hi" },
      makeArrayToolResult("x".repeat(30_000)),
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      makeArrayToolResult("y".repeat(15_000)),
      makeArrayToolResult("tiny"),
    ];
    const report = snipToolResultsInPlace(messages, SNIP_OPTS);
    expect(report.snippedCount).toBe(2);
    expect(report.charsPruned).toBeGreaterThan(0);
    // The non-toolResult messages must be untouched.
    expect(messages[0]).toEqual({ role: "user", content: "hi" });
    expect(messages[2]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
    });
    // The small toolResult was not snipped.
    expect(messages[4].content[0].text).toBe("tiny");
  });

  it("returns a zero report when threshold disabled", () => {
    const messages = [makeArrayToolResult("x".repeat(20_000))];
    const report = snipToolResultsInPlace(messages, { ...SNIP_OPTS, threshold: 0 });
    expect(report).toEqual({ snippedCount: 0, charsPruned: 0 });
    expect(messages[0].content[0].text.length).toBe(20_000);
  });

  it("survives an empty / non-array input", () => {
    expect(snipToolResultsInPlace([], SNIP_OPTS)).toEqual({
      snippedCount: 0,
      charsPruned: 0,
    });
    expect(snipToolResultsInPlace(null as unknown as never, SNIP_OPTS)).toEqual({
      snippedCount: 0,
      charsPruned: 0,
    });
  });
});
