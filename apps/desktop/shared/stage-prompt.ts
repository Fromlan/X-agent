/**
 * Stage-specific system prompt appends.
 *
 * The stage append is prepended to the existing mode append (Ask / Plan /
 * Goal / Build) so the model sees stage instructions first, then mode
 * instructions. This mirrors the existing ASK_MODE / PLAN_MODE / GOAL_MODE
 * shape (see shared/mode-prompt.ts).
 */

import type { StageId } from "./stage";

function designAppend(): string {
  return [
    "# X-agent 设计阶段 (Stage: design)",
    "目标：扩展灵感、完善方案、补充配置表。",
    "",
    "工作重心：",
    "- 产出 GDD（Game Design Document），覆盖核心玩法、机制、系统、关卡",
    "- 用 `.tres` / 数据表表达可调参数（属性、敌人、关卡、物品等）",
    "- 用灵感库沉淀参考资料、竞品分析",
    "",
    "允许：",
    "- read / write（仅在 .x-agent/design/ 下的子目录内）/ write_plan",
    "- 只读 Godot 工具（godot_detect_project / godot_editor_info / godot_open_scenes）",
    "- 只读 bash（ls / rg / find / cat）",
    "- 调用 plan 模式产出策划计划",
    "",
    "禁止：",
    "- 改 main scene 或游戏运行代码",
    "- 写原型脚本",
    "- 修改运行时项目设置（godot_set_project_setting）",
    "",
    "毕业前请确认：GDD.md 存在 + 至少 1 个数据表 + 核心玩法段落已写。",
  ].join("\n");
}

function prototypeAppend(): string {
  return [
    "# X-agent 原型阶段 (Stage: prototype)",
    "目标：拆分策划方案，制作最小可玩原型。",
    "",
    "工作重心：",
    "- 先拆方案（plan mode）再写代码",
    "- 做最小可玩循环（不追求完整内容）",
    "- 验证核心机制是否成立",
    "",
    "允许：read / write / edit / bash（cwd 限定）/ Godot 写类工具",
    "  (godot_open_scene / godot_reload_scene / godot_import_resources",
    "   / godot_set_project_setting / godot_run_main_scene / godot_run_scene)",
    "",
    "禁止：",
    "- 跳过策划文档直接写",
    "- 写完整美术 / 音效资源（原型用 placeholder）",
    "- 提前做性能优化",
    "",
    "毕业前请确认：main scene 可运行 + 至少 1 个核心循环脚本 + 引用过策划 GDD。",
  ].join("\n");
}

function testAppend(): string {
  return [
    "# X-agent 测试阶段 (Stage: test)",
    "目标：系统化游玩原型，debug + 简单完善。",
    "",
    "工作重心：",
    "- 用 x-tdd 写小测试覆盖核心循环",
    "- 用 x-diagnose 定位 bug",
    "- 用 Godot 调试器 / 场景内省工具排查问题",
    "- bug 报告写到 .x-agent/test/bugs.md",
    "",
    "允许：read / edit（仅 .x-agent/test/）/ bash / Godot 调试/内省类工具",
    "  (godot_play_errors / godot_get_debugger_state / godot_set_breakpoint",
    "   / godot_get_scene_tree / godot_get_node_properties / godot_lint_scripts",
    "   / godot_list_project_files / godot_resolve_uid / godot_inspect_script)",
    "",
    "禁止：大幅重构 / 改核心玩法设计（这是策划阶段的事）。",
    "",
    "毕业前请确认：核心循环可玩通 1 轮无 crash + 至少 3 个 bug 已修复。",
  ].join("\n");
}

function expandAppend(): string {
  return [
    "# X-agent 扩充阶段 (Stage: expand)",
    "处于游戏开发的扩充阶段，X-agent 全功能开放，按需使用。",
    "请按项目现有规范推进，遵循 x-review / x-tdd / x-safe-edit 等质量实践。",
  ].join("\n");
}

export function buildStageSystemAppend(stage: StageId): string {
  switch (stage) {
    case "design":
      return designAppend();
    case "prototype":
      return prototypeAppend();
    case "test":
      return testAppend();
    case "expand":
      return expandAppend();
  }
}
