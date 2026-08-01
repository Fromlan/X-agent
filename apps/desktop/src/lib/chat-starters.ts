export type ChatStarter = {
  id: string;
  label: string;
  prompt: string;
  /** Show only for Godot projects when true. */
  godotOnly?: boolean;
};

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

export function startersForProject(isGodotProject: boolean): ChatStarter[] {
  return CHAT_STARTERS.filter((s) => !s.godotOnly || isGodotProject);
}
