/**
 * godot_detect_project —— 离线断言：解析真实 project.godot 文件。
 *
 * 该工具由 packages/godot-pi 注册,不依赖 Pi ExtensionAPI mock,
 * 也不需要 Godot 编辑器或 RPC 连接(纯 fs 探测)。这里直接 import 底层 parser,
 * 用临时目录构造各种 project.godot 形态,锁住字段提取契约。
 *
 * 用法: tsx scripts/test-godot-detect-project.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  detectGodotProject,
  formatGodotProjectInfo,
} from "../../../packages/godot-pi/extensions/godot-project-detect.ts";

function writeProject(dir: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "project.godot");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body, "utf8");
}

const tmpRoot = mkdtempSync(join(tmpdir(), "x-agent-detect-"));
try {
  // ── 1. 缺少 project.godot：返回 isGodot=false
  //    探测一个不存在的路径,验证「目录不在」的兜底。
  const ghost = join(tmpRoot, "ghost");
  const ghostInfo = detectGodotProject(ghost);
  assert.equal(ghostInfo.isGodot, false);
  assert.equal(ghostInfo.root, ghost);
  assert.equal(ghostInfo.mainScene, null);
  assert.match(formatGodotProjectInfo(ghostInfo), /Not a Godot project root/);

  // ── 2. 最小可识别 project.godot：name + config_version + main_scene 全部命中
  const minimalDir = join(tmpRoot, "minimal");
  writeProject(
    minimalDir,
    [
      "; Engine configuration file.",
      "config_version=5",
      "",
      "[application]",
      'config/name="Demo Game"',
      'run/main_scene="res://scenes/main.tscn"',
      "",
    ].join("\n"),
  );
  const minimal = detectGodotProject(minimalDir);
  assert.equal(minimal.isGodot, true);
  assert.equal(minimal.root, minimalDir);
  assert.equal(minimal.name, "Demo Game");
  assert.equal(minimal.configVersion, "5");
  assert.equal(minimal.mainScene, "res://scenes/main.tscn");
  assert.match(formatGodotProjectInfo(minimal), /Godot project "Demo Game"/);
  assert.match(formatGodotProjectInfo(minimal), /main_scene=res:\/\/scenes\/main\.tscn/);

  // ── 3. 有 project.godot 但缺 main_scene：mainScene=null,文案不含 main_scene=
  const noMainDir = join(tmpRoot, "no-main");
  writeProject(
    noMainDir,
    [
      "config_version=5",
      "[application]",
      'config/name="CLI Tool"',
      "",
    ].join("\n"),
  );
  const noMain = detectGodotProject(noMainDir);
  assert.equal(noMain.isGodot, true);
  assert.equal(noMain.name, "CLI Tool");
  assert.equal(noMain.mainScene, null);
  assert.ok(!formatGodotProjectInfo(noMain).includes("main_scene="));

  // ── 4. 完全空白的 project.godot:也算非 Godot 项目(下游会引导用户重新生成)
  const blankDir = join(tmpRoot, "blank");
  writeProject(blankDir, "");
  const blank = detectGodotProject(blankDir);
  assert.equal(blank.isGodot, false);
  assert.match(formatGodotProjectInfo(blank), /Not a Godot project root/);

  // ── 5. 缺 config/name 的项目:回退到 "(unnamed)",避免误报
  const unnamedDir = join(tmpRoot, "unnamed");
  writeProject(
    unnamedDir,
    ["config_version=5", "[application]", "config/features=PackedStringArray()"].join("\n"),
  );
  const unnamed = detectGodotProject(unnamedDir);
  assert.equal(unnamed.isGodot, true);
  assert.equal(unnamed.name, "(unnamed)");
  assert.equal(formatGodotProjectInfo(unnamed), `Godot project "(unnamed)" (config_version=5) at ${unnamedDir}`);

  // ── 6. 引号 / 空格容错:值两端允许任意空白,引号闭合即可
  const spacedDir = join(tmpRoot, "spaced");
  writeProject(
    spacedDir,
    'config_version=5\n[application]\nconfig/name =   "Spaced Game"  \n',
  );
  const spaced = detectGodotProject(spacedDir);
  assert.equal(spaced.name, "Spaced Game");

  // ── 7. 真实仓库根目录探测 —— 仓库本身不含 project.godot,验证 false-positive 兜底
  const repoRoot = join(import.meta.dirname, "..", "..", "..");
  const repoInfo = detectGodotProject(repoRoot);
  assert.equal(repoInfo.isGodot, false, "仓库根目录不应被识别为 Godot 项目");

  // ── 8. 探测结果 details 与 info 结构完全一致(extension 工具直接转发)
  // 防止 godot-helpers.ts 包装层悄悄加 / 减字段。
  const echoDir = join(tmpRoot, "echo");
  writeProject(
    echoDir,
    'config_version=5\n[application]\nconfig/name="Echo"\nrun/main_scene="res://main.tscn"\n',
  );
  const echo = detectGodotProject(echoDir);
  assert.deepEqual(Object.keys(echo).sort(), [
    "configVersion",
    "isGodot",
    "mainScene",
    "name",
    "root",
  ]);
  assert.equal(echo.root, echoDir);

  console.log("test-godot-detect-project: ok");
  console.log(`  tmp root: ${tmpRoot}`);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}