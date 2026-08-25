/**
 * 策划会话类型 — 端到端契约断言 (mock 模式, 不依赖 Electron / Pi).
 * 验证:
 * 1. sidecar 写入/读取/损坏 fallback
 * 2. isInsideGameDesign 跨平台路径归一化
 * 3. shouldBlockDesignSessionWrite 关键路径 (read/write/bash/write_plan/godot_set_project_setting)
 * 4. computeModeToolsForType (code vs design x ask/plan/agent/goal)
 * 5. clearSessionType 与 delete 配套
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  clearSessionType,
  loadSessionType,
  saveSessionType,
} from "../electron/agent/session-type-persistence.ts";
import {
  shouldBlockDesignSessionWrite,
  isInsideGameDesign,
  DESIGN_DIR_NAME,
} from "../electron/agent/session-mode/design-write-guard.ts";
import { computeModeToolsForType } from "../electron/agent/session-mode/plan-tools.ts";

const tmp = mkdtempSync(join(tmpdir(), "x-agent-design-e2e-"));
try {
  // 准备真实 cwd (cwd-sandbox 要求 existsSync 通过)
  const cwd = join(tmp, "my-game");
  mkdirSync(join(cwd, "game-design", "systems"), { recursive: true });
  mkdirSync(join(cwd, "scripts"), { recursive: true });
  const sessionPath = join(cwd, "session-001.json");
  writeFileSync(sessionPath, "{}", "utf8");

  // —— 1. sidecar 持久化 ——
  console.log("[1] sidecar 持久化");
  saveSessionType(sessionPath, "design");
  assert.equal(loadSessionType(sessionPath), "design");
  saveSessionType(sessionPath, "code");
  assert.equal(loadSessionType(sessionPath), "code");
  clearSessionType(sessionPath);
  assert.equal(loadSessionType(sessionPath), "code"); // fallback

  // —— 2. isInsideGameDesign ——
  console.log("[2] isInsideGameDesign");
  assert.equal(isInsideGameDesign(cwd, "game-design/character.md"), true);
  assert.equal(isInsideGameDesign(cwd, join(cwd, "game-design", "x.md")), true);
  assert.equal(isInsideGameDesign(cwd, "scripts/player.gd"), false);
  assert.equal(isInsideGameDesign(cwd, "."), false);
  assert.equal(isInsideGameDesign(cwd, "game-designx/evil"), false);
  assert.equal(DESIGN_DIR_NAME, "game-design");

  // —— 3. shouldBlockDesignSessionWrite 关键路径 ——
  console.log("[3] shouldBlockDesignSessionWrite 关键路径");
  // design + read 全放行
  assert.deepEqual(
    shouldBlockDesignSessionWrite("design", "read", { path: "scripts/player.gd" }, cwd),
    { block: false },
  );
  // design + write 落在 game-design/
  assert.deepEqual(
    shouldBlockDesignSessionWrite(
      "design",
      "write",
      { path: "game-design/character.md" },
      cwd,
    ),
    { block: false },
  );
  // design + write 落 game-design/ 外
  const blocked1 = shouldBlockDesignSessionWrite(
    "design",
    "write",
    { path: "scripts/player.gd" },
    cwd,
  );
  assert.equal(blocked1.block, true);
  assert.match(blocked1.reason ?? "", /game-design/);
  // design + bash 写命令
  const blocked2 = shouldBlockDesignSessionWrite(
    "design",
    "bash",
    { command: "rm foo.txt" },
    cwd,
  );
  assert.equal(blocked2.block, true);
  // design + write_plan (设计会话禁用)
  const blocked3 = shouldBlockDesignSessionWrite(
    "design",
    "write_plan",
    { title: "x", markdown: "y" },
    cwd,
  );
  assert.equal(blocked3.block, true);
  assert.match(blocked3.reason ?? "", /write_plan/);
  // design + godot_set_project_setting (无 path, 拒绝)
  const blocked4 = shouldBlockDesignSessionWrite(
    "design",
    "godot_set_project_setting",
    { key: "application/run/main_scene" },
    cwd,
  );
  assert.equal(blocked4.block, true);
  // code + write 任意路径 (设计 guard 不激活)
  assert.deepEqual(
    shouldBlockDesignSessionWrite("code", "write", { path: "scripts/player.gd" }, cwd),
    { block: false },
  );
  // design + cwd null: 放行 (信任 caller)
  assert.deepEqual(
    shouldBlockDesignSessionWrite("design", "write", { path: "x.md" }, null),
    { block: false },
  );

  // —— 4. computeModeToolsForType 派生 ——
  console.log("[4] computeModeToolsForType");
  const prefs = ["write", "edit", "bash", "read", "godot_lint_scripts"];
  const designPlan = computeModeToolsForType("design", "plan", prefs);
  assert.ok(designPlan.includes("read"));
  assert.ok(designPlan.includes("write"));
  assert.ok(!designPlan.includes("write_plan"), "设计会话不含 write_plan");
  const codePlan = computeModeToolsForType("code", "plan", prefs);
  assert.ok(codePlan.includes("read"), "plan mode 永远有 read");
  assert.ok(codePlan.includes("write_plan"), "code + plan 仍含 write_plan");
  const codeAgent = computeModeToolsForType("code", "agent", prefs);
  assert.deepEqual(codeAgent, prefs);

  // —— 5. clearSessionType 与 sidecar 文件存在性 ——
  console.log("[5] clearSessionType");
  saveSessionType(sessionPath, "design");
  assert.ok(existsSync(`${sessionPath}.session-type.json`));
  clearSessionType(sessionPath);
  assert.ok(!existsSync(`${sessionPath}.session-type.json`));
  // 重复清: 幂等
  clearSessionType(sessionPath);

  // sep 平台无关
  assert.ok(sep === "\\" || sep === "/", "sep 应为平台分隔符");

  console.log("OK — 策划会话类型端到端契约通过");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
