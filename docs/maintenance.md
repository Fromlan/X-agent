# 仓库维护

本页记录代码、文档、分支与发版的维护步骤。工程约定见 [`CLAUDE.md`](../CLAUDE.md)，贡献流程见 [`CONTRIBUTING.md`](../CONTRIBUTING.md)，文档职责与模型上下文入口见 [`agent-context.md`](agent-context.md)。

## 维护节奏

| 周期 | 事项 | 权威来源 |
|---|---|---|
| 每周 | 整理 Issue 标签、重复任务与待审 PR；清理已完成分支 | GitHub Issues / PR、`.github/labels.yml` |
| 每周 | 检查 Dependabot；涉及 Pi / Electron / 网络与工具边界的更新须完成对应回归 | `.github/dependabot.yml`、`apps/desktop/package.json` |
| 每月 | 核对路线图状态、技术债与文档偏差 | [`roadmap.md`](roadmap.md)、源码与测试 |
| 每季度 | 评估主要依赖升级，单独开 Issue / 分支验证 | 上游发布说明与锁文件 |
| 发版前 | 整理用户可见变更、版本与验证结果 | [`CHANGELOG.md`](../CHANGELOG.md)、`apps/desktop/package.json` |
| 每年 | 核对贡献流程、行为准则、安全报告与支持版本 | [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md)、[`SECURITY.md`](../SECURITY.md) |

## 代码与验证

依赖与锁文件在 `apps/desktop`；根目录只转发脚本，没有 `test` 脚本。

在 `apps/desktop` 执行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:coverage`。类型检查同时拒绝未使用的导入、局部变量与参数；删除未使用变量时保留其初始化表达式中必要的副作用。公开导出与兼容入口须先核对调用方，不能仅凭本文件未使用就删除。

`npm test` 的离线断言串行执行，完整命令以 `package.json:scripts.test` 为准；Vitest 单独由 `test:unit` / `test:coverage` 执行。测试须使用临时目录，不能读写维护者真实的 Pi 偏好或会话数据。

构建与界面检查执行 `npm run build`、`npm run test:e2e`。真实 Godot 集成执行 `npm run test:godot`，PowerShell 的 `$env:GODOT_BIN` 必须指向 Godot 4.7.2 console 可执行文件；缺少环境时检查明确失败。真实模型冒烟另需 Pi 认证，不属于离线检查。

## 文档对齐

按职责维护，避免在多处复制完整测试清单或实现说明：

- [`README.md`](../README.md) / [`README.en.md`](../README.en.md)：用户能力与使用步骤。
- [`AGENTS.md`](../AGENTS.md)：编码助手必须提前知道的边界与入口。
- [`CLAUDE.md`](../CLAUDE.md)：协作、PR、发布流程与架构导航。
- [`agent.md`](agent.md)：技术栈、验证命令与查阅入口。
- [`context.md`](context.md)：领域概念与当前模块职责。
- [`agent-context.md`](agent-context.md)：模型实际上下文的加载规则。
- [`design.md`](design.md)：主题、几何与布局约定。
- [`roadmap.md`](roadmap.md)：后续候选方向；具体范围和交付状态以 Issue / PR 为准。

版本以 `apps/desktop/package.json` 为准，addon 版本以 `plugin.cfg` 为准，工具与 IPC 以共享注册表、类型和 preload 为准。在根目录执行 `npm run doc:drift`，修改检查器时再运行 `npm run test:doc-drift`。文档链接应从所在文件目录解析；GitHub Issues、安全报告等页面使用完整仓库链接。

Pi 每个目录只选择一个上下文入口；本仓库默认是 `AGENTS.md`，不会同时自动注入 `CLAUDE.md`、`docs/agent.md` 与 `docs/context.md`。入口链接不会自动展开文档正文。修改上下文约定时同时核对加载器实现。

`docs/` 是公开文档；个人草稿、临时检查报告与本机操作记录放在 `.scratch/notes/`，不提交。

## 分支清理

先执行 `git fetch origin --prune` 更新远端引用，再检查 `git branch -vv`、`git worktree list` 与开放 PR。远端分支不存在只代表引用已删除，不能据此判定本地工作已合并。

普通合并可用 `git branch --merged origin/master` 核对，并用 `git branch -d` 删除。Squash 合并通常不满足祖先关系；必须确认 PR 已合并、本地分支顶点等于 PR 合并时的 head，或确认本地顶点是该 PR 中已包含的旧提交，且没有合并后新增的独有改动，才使用 `git branch -D` 删除指定引用。

保留 `master`、当前分支、被工作区占用的分支、开放 PR 分支与存在未合并工作的分支。远端实体分支只在核对为已完成后删除；`fetch --prune` 只清理本地跟踪引用。

## Release Cadence

没有固定发版日；在用户可见改进、重要修复或阶段交付值得发布时发版。

1. 将 `CHANGELOG.md` 的 `Unreleased` 内容整理为非空 `## X.Y.Z` 章节；说明用户可见行为。
2. 从 `master` 创建发版分支，在根目录执行 `npm run release:prepare -- X.Y.Z`，核对包版本、锁文件与更新说明。
3. 提交并推送发版分支，创建面向 `master` 的 PR；完成必需检查与 review 后合并。
4. maintainer 在合并后的 `master` 提交上创建并推送 `vX.Y.Z` tag。Agent 不直接推送 `master`，不主动打 tag。
5. `release.yml` 核对 tag / HEAD / 包版本 / 更新说明，完成类型、lint、离线测试、覆盖率、构建、E2E 与真实 Godot 检查后打包；独立 publish job 上传 GitHub Release。

`release:prepare` 只修改版本与检查更新说明，不提交、推送或创建 tag。包版本领先最新 tag 时默认拒绝再次准备，需核对前一次发版状态；`--force` 仅是显式绕过选项。

本地 `npm run release:dist` 用于冒烟，产物不作为发布源；不提交 `apps/desktop/release/`、`out/`、覆盖率、E2E 产物或 `node_modules.broken-*`。用户下载的权威产物是 CI 的 GitHub Release。
