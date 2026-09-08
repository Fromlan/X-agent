/**
 * 启动期失败摘要 (主题 E #62 拆分, 2026-09-08).
 *
 * 启动期几个 best-effort 阶段 (shadow_recover / godot_rpc / godot_pi_install)
 * 失败时记一条到 `startupIssues`, renderer 通过 IPC `getStartupReport` 一次性
 * 拉取, 在 ReadyChecklist 提示用户「上次启动有 X 失败」.
 *
 * 与 prefs recovery notice 同属启动期一次性队列, 抽取为独立 module 便于
 * 独立 vitest.
 */
export type StartupIssue = {
  stage: "shadow_recover" | "godot_rpc" | "godot_pi_install";
  message: string;
};

const MAX_KEPT = 32;

let issues: StartupIssue[] = [];

export function pushStartupIssue(issue: StartupIssue): void {
  issues.push(issue);
  // 限制条数, 避免磁盘写错误 / 端口冲突等反复堆积.
  if (issues.length > MAX_KEPT) {
    issues = issues.slice(-MAX_KEPT);
  }
}

export function consumeStartupIssues(): StartupIssue[] {
  const out = issues;
  issues = [];
  return out;
}

/** Test-only: 清空 startup issue 队列, 避免多测例互相污染. */
export function _resetStartupIssuesForTests(): void {
  issues = [];
}
