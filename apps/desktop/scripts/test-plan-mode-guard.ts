import assert from "node:assert/strict";
import { shouldBlockPlanToolCall } from "../electron/agent/plan-mode-guard.ts";

const allowed = ["read", "grep", "find", "ls", "write_plan"] as const;

assert.deepEqual(
  shouldBlockPlanToolCall("agent", "write", allowed),
  { block: false },
);
assert.deepEqual(
  shouldBlockPlanToolCall("goal", "bash", allowed),
  { block: false },
);
assert.equal(
  shouldBlockPlanToolCall("plan", "read", allowed).block,
  false,
);
assert.equal(
  shouldBlockPlanToolCall("plan", "write_plan", allowed).block,
  false,
);
assert.equal(
  shouldBlockPlanToolCall("plan", "write", allowed).block,
  true,
);
assert.equal(
  shouldBlockPlanToolCall("plan", "edit", allowed).block,
  true,
);
assert.equal(
  shouldBlockPlanToolCall("plan", "bash", allowed).block,
  true,
);
assert.ok(
  shouldBlockPlanToolCall("plan", "bash", allowed).reason?.includes("bash"),
);

console.log("test-plan-mode-guard: ok");
