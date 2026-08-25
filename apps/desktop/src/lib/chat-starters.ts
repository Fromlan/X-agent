import type { SessionType } from "@shared/session-type";

export type ChatStarter = {
  id: string;
  label: string;
  prompt: string;
  /** Show only for Godot projects when true. */
  godotOnly?: boolean;
};

/** 代码会话 (code) 默认 starters —— 围绕调试 / 跑场景 / 改代码. */
export const CHAT_STARTERS: ChatStarter[] = [
  {
    id: "audit-script",
    label: "审查当前脚本",
    prompt:
      "请审查当前打开或最近修改的 GDScript：指出潜在 bug、可维护性问题，并给出最小改动建议。",
    godotOnly: true,
  },
  {
    id: "run-scene",
    label: "运行当前场景",
    prompt:
      "请通过 Godot RPC 运行当前编辑场景，收集报错并帮我定位原因。若工具未启用请先提示我开启。",
    godotOnly: true,
  },
  {
    id: "docs-lookup",
    label: "Godot 文档要点",
    prompt:
      "请阅读技能 godot-docs-4-7，解释 Node 生命周期（_ready / _process / _physics_process）及常见误用，并给出推荐写法。",
    godotOnly: true,
  },
  {
    id: "project-overview",
    label: "了解项目结构",
    prompt: "请浏览本项目目录，总结场景、脚本与资源的组织方式，并指出从哪里入手最合适。",
  },
  {
    id: "fix-bug",
    label: "帮我修一个问题",
    prompt: "我想修一个问题：请先问我现象与复现步骤，再逐步排查。",
  },
];

/** 策划会话 (design) 默认 starters —— 围绕世界 / 角色 / 玩法 / 数值 / GDD.
 *  这些 prompt 引导模型去 <cwd>/game-design/ 写文档, 而不是改代码. */
export const DESIGN_CHAT_STARTERS: ChatStarter[] = [
  {
    id: "design-character",
    label: "设计一个角色",
    prompt:
      "请帮我设计一个可玩的角色：在 <cwd>/game-design/characters/ 下新建 markdown，" +
      "包含身份背景、核心动机、玩法定位（坦克/输出/辅助…）、关键技能草案、数值锚点（HP/MP/攻速）。" +
      "若已有同目录文件请先扫一眼, 保持设定一致。",
  },
  {
    id: "design-world",
    label: "搭世界观框架",
    prompt:
      "请帮我搭建世界观框架：在 <cwd>/game-design/world/ 下创建或扩展 markdown，" +
      "覆盖时代背景、地理、社会结构、核心冲突、玩家扮演的角色. " +
      "若尚未建立 game-design/ 目录, 顺便初始化子目录结构。",
  },
  {
    id: "design-core-loop",
    label: "定义核心玩法循环",
    prompt:
      "请梳理本项目的核心玩法循环：3-5 步玩家行为 + 每步反馈 + 资源/数值流向. " +
      "输出到 <cwd>/game-design/core-loop.md, 并用 1-2 段话讲清它和现有项目哪些系统对接。",
  },
  {
    id: "design-data-table",
    label: "设计一张数值表",
    prompt:
      "请设计一张数值表（角色属性 / 武器 / 掉落 / 经济等任选）：列字段、单位、范围、参考来源。" +
      "优先用 markdown 表格写到 <cwd>/game-design/tables/。" +
      "若 Godot 项目且表适合 .tres 落地, 提示我切回代码会话再用 Godot 工具落表。",
  },
  {
    id: "design-level",
    label: "拆一个关卡机制",
    prompt:
      "请帮我拆一个关卡的核心机制：玩家目标 → 阻碍 → 资源点 → 难度曲线 → 通关条件. " +
      "输出到 <cwd>/game-design/levels/<关卡名>.md, 可附 ASCII 流程图。",
  },
  {
    id: "design-gdd-scaffold",
    label: "整理 GDD 目录",
    prompt:
      "请扫一下 <cwd>/game-design/ 现状, 输出当前缺哪些 GDD 章节（概念 / 玩法 / 系统 / 美术方向 / 技术约束 / 路线图），" +
      "并按推荐顺序给我一份 30 秒可勾选的待办清单, 我会一项一项让你展开写。",
  },
];

export function startersForProject(
  isGodotProject: boolean,
  sessionType: SessionType = "code",
): ChatStarter[] {
  if (sessionType === "design") {
    return DESIGN_CHAT_STARTERS;
  }
  return CHAT_STARTERS.filter((s) => !s.godotOnly || isGodotProject);
}

