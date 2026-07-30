/**
 * Unit tests for the pure helpers extracted from session-host.ts into
 * session-host-helpers.ts. No Electron / Pi runtime required.
 */
import assert from "node:assert/strict";
import {
  emptyUsageSnapshot,
  failOpen,
  serializeForDetail,
  turnUsageFromMessage,
} from "../electron/agent/session-host-helpers";

// --- failOpen -----------------------------------------------------------

{
  const result = failOpen("boom");
  assert.equal(result.ok, false);
  assert.equal(result.error, "boom");
  assert.equal(result.cwd, "");
  assert.equal(result.sessionId, "");
  assert.equal(result.model, null);
  assert.equal(result.thinkingLevel, "off");
}

{
  const result = failOpen("boom", "/some/project");
  assert.equal(result.cwd, "/some/project");
  assert.equal(result.error, "boom");
}

// --- turnUsageFromMessage -------------------------------------------------

{
  // valid usage
  const usage = turnUsageFromMessage({
    stopReason: "stop",
    usage: {
      input: 100,
      output: 50,
      cacheRead: 10,
      cacheWrite: 5,
      totalTokens: 165,
      cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.0005, total: 0.0315 },
    },
  });
  assert.ok(usage, "valid usage should produce a TurnUsage");
  assert.equal(usage!.tokens.input, 100);
  assert.equal(usage!.tokens.output, 50);
  assert.equal(usage!.tokens.cacheRead, 10);
  assert.equal(usage!.tokens.cacheWrite, 5);
  assert.equal(usage!.tokens.total, 165);
  assert.equal(usage!.cost.total, 0.0315);
}

{
  // aborted -> null
  const usage = turnUsageFromMessage({
    stopReason: "aborted",
    usage: { input: 100, output: 50, totalTokens: 150 },
  });
  assert.equal(usage, null, "aborted messages must yield no usage");
}

{
  // error -> null
  const usage = turnUsageFromMessage({
    stopReason: "error",
    usage: { input: 100, output: 50, totalTokens: 150 },
  });
  assert.equal(usage, null, "error messages must yield no usage");
}

{
  // empty / missing usage -> null
  assert.equal(turnUsageFromMessage({ stopReason: "stop" }), null, "missing usage");
  assert.equal(
    turnUsageFromMessage({ stopReason: "stop", usage: {} }),
    null,
    "empty usage object",
  );
  assert.equal(
    turnUsageFromMessage({
      stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    }),
    null,
    "all-zero usage",
  );
  assert.equal(turnUsageFromMessage(null), null, "null message");
  assert.equal(turnUsageFromMessage("nope"), null, "non-object message");
}

// --- serializeForDetail truncation ----------------------------------------

{
  const short = serializeForDetail("hello");
  assert.equal(short.value, "hello");
  assert.equal(short.truncated, false);
}

{
  const big = "x".repeat(256 * 1024 + 100);
  const result = serializeForDetail(big);
  assert.equal(result.truncated, true, "oversized string must be truncated");
  assert.ok(
    typeof result.value === "string" && result.value.length < big.length,
    "truncated value must be shorter than input",
  );
  assert.ok(
    (result.value as string).includes("截断"),
    "truncated value should include truncation marker",
  );
}

{
  // JSON-serialized object under the limit should pass through untouched (by reference)
  const obj = { a: 1, b: "small" };
  const result = serializeForDetail(obj);
  assert.equal(result.truncated, false);
  assert.equal(result.value, obj);
}

{
  // Oversized object gets serialized + truncated
  const obj = { data: "y".repeat(256 * 1024 + 100) };
  const result = serializeForDetail(obj);
  assert.equal(result.truncated, true);
  assert.equal(typeof result.value, "string");
}

// --- emptyUsageSnapshot -----------------------------------------------------

{
  const snap = emptyUsageSnapshot();
  assert.deepEqual(snap.tokens, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  });
  assert.equal(snap.cost, 0);
  assert.equal(snap.context, null);
  assert.equal(snap.userMessages, 0);
  assert.equal(snap.assistantMessages, 0);
  assert.equal(snap.toolCalls, 0);
  assert.equal("lastTurn" in snap, false, "empty snapshot should have no lastTurn field");
}

console.log("session-host-helpers: ok");
