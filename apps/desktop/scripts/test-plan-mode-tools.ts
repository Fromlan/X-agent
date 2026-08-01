import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { setAgentDirOverrideForTests } from "../electron/agent/prefs.ts";
import {
  buildImplementPrompt,
  buildPlanFilePath,
  classifyPlanLocation,
  computeAskModeTools,
  computePlanModeTools,
  formatPlanTimestamp,
  getPlansDir,
  getWorkspacePlansDir,
  isAllowedPlanPath,
  savePlanToWorkspacePath,
  slugifyPlanTitle,
  stubPlanRejection,
  writePlanMarkdown,
} from "../electron/agent/plan-tools.ts";
import {
  PLAN_MODE_CORE_TOOLS,
  READONLY_CORE_TOOLS,
  SESSION_TOOL_REGISTRY,
  WRITE_PLAN_TOOL,
} from "../shared/ipc.ts";
import {
  buildAskModeSystemAppend,
  buildPlanModeSystemAppend,
  stripModeBlocks,
} from "../shared/mode-prompt.ts";

// Registry allowlist must include write_plan or Pi drops the custom tool.
assert.ok(
  (SESSION_TOOL_REGISTRY as readonly string[]).includes(WRITE_PLAN_TOOL),
  "SESSION_TOOL_REGISTRY must include write_plan",
);
for (const name of PLAN_MODE_CORE_TOOLS) {
  assert.ok(
    (SESSION_TOOL_REGISTRY as readonly string[]).includes(name),
    `SESSION_TOOL_REGISTRY missing plan tool ${name}`,
  );
}

assert.equal(slugifyPlanTitle("Hello World!"), "hello-world");
assert.equal(slugifyPlanTitle("  "), "plan");
assert.ok(slugifyPlanTitle("添加用户认证").length > 0);

const ts = formatPlanTimestamp(new Date("2026-07-31T14:05:06"));
assert.match(ts, /^20260731-140506$/);

assert.deepEqual([...READONLY_CORE_TOOLS], ["read", "grep", "find", "ls", "bash"]);

assert.deepEqual(computeAskModeTools(["read", "bash", "write", "edit"]), [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
]);
assert.ok(!computeAskModeTools(["read", "bash"]).includes("write_plan"));
assert.deepEqual(
  computeAskModeTools([
    "read",
    "godot_run_scene",
    "godot_editor_info",
  ]),
  ["read", "grep", "find", "ls", "bash", "godot_editor_info"],
);

assert.deepEqual(computePlanModeTools(["read", "bash", "write", "edit"]), [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "write_plan",
]);
assert.deepEqual(
  computePlanModeTools([
    "read",
    "godot_run_scene",
    "godot_editor_info",
  ]),
  [
    "read",
    "grep",
    "find",
    "ls",
    "bash",
    "write_plan",
    "godot_editor_info",
  ],
);

const prompt = buildImplementPrompt("C:\\plans\\demo.md");
assert.ok(prompt.includes('<mode name="build">'));
assert.ok(prompt.includes("C:\\plans\\demo.md"));
assert.ok(prompt.includes("Implement"));
assert.equal(stripModeBlocks(prompt).trim(), "");

const askAppend = buildAskModeSystemAppend();
assert.ok(askAppend.includes("# X-agent Ask mode"));
assert.ok(askAppend.includes("read-only bash"));
assert.ok(!askAppend.includes("call write_plan once"));

const append = buildPlanModeSystemAppend();
assert.ok(append.includes("# X-agent Plan mode"));
assert.ok(append.includes("write_plan"));
assert.ok(append.includes("执行计划"));
assert.ok(append.includes("Never call write_plan with placeholders"));
assert.ok(append.includes("research"));
assert.ok(append.includes("<clarify>"));
assert.ok(append.includes("- [ ]"));

assert.ok(stubPlanRejection("placeholder", "# placeholder\n\nplaceholder\n"));
assert.ok(stubPlanRejection("草稿", "## Goal\nx\n## Steps\ny\n"));
assert.ok(
  stubPlanRejection(
    "Add feature",
    "# Add feature\n\nToo short without sections.\n",
  ),
);
assert.ok(
  stubPlanRejection(
    "Add feature",
    [
      "# Add feature",
      "",
      "## Approach",
      "Do stuff",
      "",
      "## Files",
      "- a.ts",
    ].join("\n"),
  ),
  "missing Goal/Steps",
);
assert.equal(
  stubPlanRejection(
    "增加新怪物类型",
    [
      "# 增加新怪物类型",
      "",
      "## Goal",
      "新增一种怪物并接入生成池。",
      "",
      "## Approach",
      "扩展 enemy.gd 枚举与绘制。",
      "",
      "## Steps",
      "1. 改 enemy.gd",
      "2. 改 main.gd 权重",
      "",
      "## Files",
      "- scripts/enemy.gd",
      "- scripts/main.gd",
      "",
      "## Validation",
      "运行游戏确认新怪物出现。",
      "",
      "## Out of scope",
      "不改玩家系统。",
    ].join("\n"),
  ),
  null,
);

const dir = mkdtempSync(join(tmpdir(), "x-agent-plan-"));
try {
  setAgentDirOverrideForTests(dir);
  const plansDir = getPlansDir();
  assert.equal(plansDir, join(dir, "x-agent", "plans"));
  const path = buildPlanFilePath("Auth Flow", new Date("2026-01-02T03:04:05"));
  assert.ok(path.includes("20260102-030405"));
  assert.ok(path.endsWith(".md"));

  mkdirSync(plansDir, { recursive: true });
  writeFileSync(path, "# Auth Flow\n\n## Goal\nDone\n", "utf8");
  const body = readFileSync(path, "utf8");
  assert.ok(body.includes("## Goal"));

  assert.equal(classifyPlanLocation(path, null), "home");
  assert.equal(isAllowedPlanPath(path, null), true);
  assert.equal(isAllowedPlanPath(join(dir, "elsewhere.md"), dir), false);

  const project = join(dir, "proj");
  mkdirSync(project, { recursive: true });
  assert.equal(getWorkspacePlansDir(project), join(project, ".pi", "plans"));
  writePlanMarkdown(path, "# Auth Flow\nv2\n");
  const wsPath = savePlanToWorkspacePath(path, project);
  assert.equal(classifyPlanLocation(wsPath, project), "workspace");
  assert.ok(existsSync(wsPath));
  assert.ok(!existsSync(path), "home original removed after move");
  assert.ok(readFileSync(wsPath, "utf8").includes("v2"));
} finally {
  setAgentDirOverrideForTests(null);
  rmSync(dir, { recursive: true, force: true });
}

console.log("test-plan-mode-tools: ok");
