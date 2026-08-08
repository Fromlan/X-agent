import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldBlockReadonlyModeToolCall } from "../electron/agent/session-mode/plan-mode-guard.ts";
import { isReadonlyBashCommand } from "../electron/agent/session-mode/bash-readonly.ts";

const planAllowed = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "write_plan",
  "godot_detect_project",
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

// A8: path-carrying read tools (read/grep/find/ls) must stay inside cwd.
const guardCwd = mkdtempSync(join(tmpdir(), "x-agent-guard-"));
mkdirSync(join(guardCwd, "src"), { recursive: true });
writeFileSync(join(guardCwd, "src", "a.ts"), "x", "utf8");
try {
  assert.equal(
    shouldBlockReadonlyModeToolCall("plan", "read", planAllowed, { path: "src/a.ts" }, guardCwd).block,
    false,
    "relative in-cwd read ok",
  );
  assert.equal(
    shouldBlockReadonlyModeToolCall("plan", "read", planAllowed, { path: join(guardCwd, "src", "a.ts") }, guardCwd).block,
    false,
    "absolute in-cwd read ok",
  );
  assert.equal(
    shouldBlockReadonlyModeToolCall("plan", "ls", planAllowed, { path: "src" }, guardCwd).block,
    false,
    "ls in-cwd ok",
  );
  assert.equal(
    shouldBlockReadonlyModeToolCall("ask", "grep", askAllowed, { pattern: "x", path: "src" }, guardCwd).block,
    false,
    "grep in-cwd ok",
  );
  assert.equal(
    shouldBlockReadonlyModeToolCall("ask", "find", askAllowed, { pattern: "*.ts", path: "src" }, guardCwd).block,
    false,
    "find in-cwd ok",
  );
  assert.equal(
    shouldBlockReadonlyModeToolCall("plan", "read", planAllowed, { path: "../outside.txt" }, guardCwd).block,
    true,
    "relative .. escape blocked",
  );
  assert.equal(
    shouldBlockReadonlyModeToolCall("plan", "read", planAllowed, { path: "C:\\Windows\\win.ini" }, guardCwd).block,
    true,
    "absolute outside blocked",
  );
  assert.equal(
    shouldBlockReadonlyModeToolCall("plan", "read", planAllowed, { path: "~/.ssh/id_rsa" }, guardCwd).block,
    true,
    "tilde home path blocked",
  );
  assert.equal(
    shouldBlockReadonlyModeToolCall("plan", "read", planAllowed, { path: "file:///etc/passwd" }, guardCwd).block,
    true,
    "file:// outside blocked",
  );
  assert.equal(
    shouldBlockReadonlyModeToolCall("plan", "read", planAllowed, { path: 42 }, guardCwd).block,
    true,
    "non-string path blocked",
  );
  assert.equal(
    shouldBlockReadonlyModeToolCall("plan", "godot_detect_project", planAllowed, { path: guardCwd }, guardCwd).block,
    false,
    "godot_detect_project in-cwd ok",
  );
  assert.equal(
    shouldBlockReadonlyModeToolCall("plan", "godot_detect_project", planAllowed, { path: "C:\\Windows" }, guardCwd).block,
    true,
    "godot_detect_project outside blocked",
  );
} finally {
  rmSync(guardCwd, { recursive: true, force: true });
}

console.log("test-plan-mode-guard: ok");
