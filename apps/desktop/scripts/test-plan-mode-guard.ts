import assert from "node:assert/strict";
import {
  shouldBlockPlanToolCall,
  shouldBlockReadonlyModeToolCall,
} from "../electron/agent/plan-mode-guard.ts";

const planAllowed = ["read", "grep", "find", "ls", "write_plan"] as const;
const askAllowed = ["read", "grep", "find", "ls"] as const;

assert.deepEqual(
  shouldBlockReadonlyModeToolCall("agent", "write", planAllowed),
  { block: false },
);
assert.deepEqual(
  shouldBlockReadonlyModeToolCall("goal", "bash", planAllowed),
  { block: false },
);
assert.equal(
  shouldBlockReadonlyModeToolCall("plan", "read", planAllowed).block,
  false,
);
assert.equal(
  shouldBlockReadonlyModeToolCall("plan", "write_plan", planAllowed).block,
  false,
);
assert.equal(
  shouldBlockReadonlyModeToolCall("plan", "write", planAllowed).block,
  true,
);
assert.equal(
  shouldBlockReadonlyModeToolCall("plan", "edit", planAllowed).block,
  true,
);
assert.equal(
  shouldBlockReadonlyModeToolCall("plan", "bash", planAllowed).block,
  true,
);
assert.ok(
  shouldBlockReadonlyModeToolCall("plan", "bash", planAllowed).reason?.includes(
    "bash",
  ),
);

assert.equal(
  shouldBlockReadonlyModeToolCall("ask", "read", askAllowed).block,
  false,
);
assert.equal(
  shouldBlockReadonlyModeToolCall("ask", "write", askAllowed).block,
  true,
);
assert.equal(
  shouldBlockReadonlyModeToolCall("ask", "edit", askAllowed).block,
  true,
);
assert.equal(
  shouldBlockReadonlyModeToolCall("ask", "bash", askAllowed).block,
  true,
);
assert.equal(
  shouldBlockReadonlyModeToolCall("ask", "write_plan", askAllowed).block,
  true,
);
assert.ok(
  shouldBlockReadonlyModeToolCall("ask", "bash", askAllowed).reason?.includes(
    "调研",
  ),
);

// Alias still works for existing callers.
assert.equal(shouldBlockPlanToolCall("ask", "write", askAllowed).block, true);

console.log("test-plan-mode-guard: ok");
