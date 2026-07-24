/**
 * Role-wrapped prompts for Fleet codegen-review pair orchestration.
 */

export function workerWave1Prompt(task: string): string {
  return [
    "【Fleet 角色：实现槽 / worker】",
    "你负责在当前项目中直接改代码、落地实现，完成下面的任务。",
    "优先动手修改；必要时用工具读文件与验证。完成后简要总结改了什么。",
    "",
    "—— 任务 ——",
    task.trim(),
  ].join("\n");
}

export function reviewerWave1Prompt(task: string): string {
  return [
    "【Fleet 角色：审阅槽 / reviewer】",
    "实现槽会并行改代码。你这一波先不要大改代码。",
    "请针对同一任务列出：风险点、审查关注清单、边界条件与回归建议。",
    "输出结构化清单即可，等待后续 handoff 再做基于变更的具体审查。",
    "",
    "—— 任务 ——",
    task.trim(),
  ].join("\n");
}

export function reviewerWave2Prompt(task: string, handoff: string): string {
  return [
    "【Fleet 角色：审阅槽 / reviewer · Wave2】",
    "实现槽已完成本轮实现。请基于下方 handoff（优先为 git diff 摘要）做具体审查：",
    "指出问题、遗漏、风险，并给出可执行的修改建议。仍避免无关的大范围重写。",
    "",
    "—— 原任务 ——",
    task.trim(),
    "",
    "—— Handoff ——",
    handoff.trim() || "（无可用 diff / 会话摘录）",
  ].join("\n");
}
