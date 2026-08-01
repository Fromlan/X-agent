import assert from "node:assert/strict";
import { shouldBlockReadonlyModeToolCall } from "../electron/agent/plan-mode-guard.ts";
import { isReadonlyBashCommand } from "../electron/agent/bash-readonly.ts";

const planAllowed = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "write_plan",
] as const;
const askAllowed = ["read", "grep", "find", "ls", "bash"] as const;

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

// Read-only bash allowed
assert.equal(
  shouldBlockReadonlyModeToolCall("plan", "bash", planAllowed, {
    command: "git status",
  }).block,
  false,
);
assert.equal(
  shouldBlockReadonlyModeToolCall("ask", "bash", askAllowed, {
    command: "ls -la",
  }).block,
  false,
);

// Mutating bash blocked
assert.equal(
  shouldBlockReadonlyModeToolCall("plan", "bash", planAllowed, {
    command: "rm -rf src",
  }).block,
  true,
);
assert.equal(
  shouldBlockReadonlyModeToolCall("ask", "bash", askAllowed, {
    command: "git commit -am x",
  }).block,
  true,
);
assert.ok(
  shouldBlockReadonlyModeToolCall("plan", "bash", planAllowed, {
    command: "echo hi > file.txt",
  }).reason?.includes("只读"),
);

assert.equal(
  shouldBlockReadonlyModeToolCall(
    "plan",
    "bash",
    planAllowed,
    { command: "cat ../outside.txt" },
    "D:/proj",
  ).block,
  true,
);
assert.equal(
  shouldBlockReadonlyModeToolCall(
    "ask",
    "bash",
    askAllowed,
    { command: "ls src" },
    "D:/proj",
  ).block,
  false,
);

assert.equal(
  shouldBlockReadonlyModeToolCall("ask", "write", askAllowed).block,
  true,
);
assert.equal(
  shouldBlockReadonlyModeToolCall("ask", "write_plan", askAllowed).block,
  true,
);

assert.equal(isReadonlyBashCommand("git status --short"), true);
assert.equal(isReadonlyBashCommand("rg TODO src"), true);
assert.equal(isReadonlyBashCommand("git stash list"), true);
assert.equal(isReadonlyBashCommand("git add ."), false);
assert.equal(isReadonlyBashCommand("npm install"), false);

console.log("test-plan-mode-guard: ok");
