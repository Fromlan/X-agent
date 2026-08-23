/**
 * Static definitions for each game development workflow stage.
 *
 * The data here drives:
 * - Right-panel tab layout (preferredRightPanelTab + rightPanelTabs)
 * - System prompt append (systemAppend) injected before mode append
 * - Default mode (defaultMode) the session lands in when entering the stage
 * - Tool preset (toolPreset) used by computeStageTools
 * - Skill preset (skillPreset) used by filterSkillsForStage
 * - Graduation checks surfaced in the stage-switch modal
 * - Artifact directory and CSS color token
 */

import type { StageDefinition, StageId } from "./stage";
import { buildStageSystemAppend } from "./stage-prompt";

export const STAGE_DEFINITIONS: Record<StageId, StageDefinition> = {
  design: {
    id: "design",
    label: "策划阶段",
    shortLabel: "策划",
    description: "扩展灵感、完善方案、补充配置",
    icon: "lightbulb",
    defaultMode: "plan",
    toolPreset: "readonly-design",
    skillPreset: "design",
    systemAppend: buildStageSystemAppend("design"),
    rightPanelTabs: ["context", "plan", "design", "files"],
    preferredRightPanelTab: "design",
    graduation: [
      {
        id: "design-gdd",
        label: "至少 1 个 GDD 文档（.x-agent/design/*.md）",
        kind: "file-count",
        pattern: "*.md",
        min: 1,
      },
      {
        id: "design-config-table",
        label: "至少 1 个数据表（Godot 项目需 .tres / 其他可手动勾）",
        kind: "glob-count",
        pattern: "*.tres",
        min: 1,
      },
      {
        id: "design-core-loop",
        label: "GDD 内有「核心玩法」章节",
        kind: "manual",
      },
    ],
    artifactsDir: ".x-agent/design",
    color: "var(--stage-design)",
  },
  prototype: {
    id: "prototype",
    label: "原型阶段",
    shortLabel: "原型",
    description: "拆分方案，制作最小可玩原型",
    icon: "box",
    defaultMode: "agent",
    toolPreset: "prototype-write",
    skillPreset: "prototype",
    systemAppend: buildStageSystemAppend("prototype"),
    rightPanelTabs: ["context", "plan", "prototype", "files", "godot"],
    preferredRightPanelTab: "prototype",
    graduation: [
      {
        id: "prototype-main-scene",
        label: "存在可运行的 main scene",
        kind: "manual",
      },
      {
        id: "prototype-core-script",
        label: "至少 1 个核心循环脚本",
        kind: "manual",
      },
      {
        id: "prototype-gdd-referenced",
        label: "策划阶段 GDD 已被原型脚本引用",
        kind: "manual",
      },
    ],
    artifactsDir: ".x-agent/prototype",
    color: "var(--stage-prototype)",
  },
  test: {
    id: "test",
    label: "测试阶段",
    shortLabel: "测试",
    description: "游玩原型，debug + 简单完善",
    icon: "flask-conical",
    defaultMode: "agent",
    toolPreset: "test-debug",
    skillPreset: "test",
    systemAppend: buildStageSystemAppend("test"),
    rightPanelTabs: ["context", "tools", "godot", "test"],
    preferredRightPanelTab: "test",
    graduation: [
      {
        id: "test-playthrough",
        label: "核心循环可连续玩通 1 轮无 crash",
        kind: "manual",
      },
      {
        id: "test-bug-fixes",
        label: "至少修复 3 个 bug",
        kind: "manual",
      },
    ],
    artifactsDir: ".x-agent/test",
    color: "var(--stage-test)",
  },
  expand: {
    id: "expand",
    label: "扩充阶段",
    shortLabel: "扩充",
    description: "正常制作，X-agent 全功能",
    icon: "rocket",
    defaultMode: "agent",
    toolPreset: "full",
    skillPreset: "full",
    systemAppend: buildStageSystemAppend("expand"),
    rightPanelTabs: ["context", "plan", "tools", "files", "godot"],
    preferredRightPanelTab: "context",
    graduation: [],
    artifactsDir: ".x-agent/expand",
    color: "var(--stage-expand)",
  },
};
