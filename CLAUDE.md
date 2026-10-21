# CLAUDE.md

本文件维护 X-agent 的协作、PR、发布流程与架构导航。编码前的硬约束集中在 [AGENTS.md](AGENTS.md)，命令与技术栈见 [docs/agent.md](docs/agent.md)。同一目录的上下文入口选择规则见 [Agent 上下文说明](docs/agent-context.md)。

## 项目概览

X-agent 是基于 Pi SDK 的 Godot 4 专用 Electron 桌面 Agent，当前开发与发布平台为 Windows。仓库只有一个实际应用 `apps/desktop`；根 `package.json` 仅转发脚本，依赖、锁文件和权威版本位于应用目录。

当前功能及使用步骤见 [README.md](README.md) / [README.en.md](README.en.md)，已发布变更见 [CHANGELOG.md](CHANGELOG.md)，后续候选方向见 [路线图](docs/roadmap.md)。路线图不代替 Issue 的范围和验收约定。

## 开发流程

### 1. 定位与边界

项目服务于 Godot 4 的脚本、场景和编辑器工作流；当前不提供通用 IDE、移动客户端、独立浏览器应用或实时多人协作。新增方向须先明确与现有定位的关系。

### 2. Issue 与规划

- 想法、任务和 Bug 记录在 [GitHub Issues](https://github.com/Fromlan/X-agent/issues)。
- 标签以 `.github/labels.yml` 为准：类型、优先级和 `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` 等状态分开维护。
- 大块工作明确范围、依赖和验收；小修不强制添加里程碑。
- 已完成工作的记录进入 PR 与更新说明，不在多份文档重复维护逐项完成清单。

### 3. 分支策略 GitHub Flow

- `master` 始终保持可发布，检查必须通过；`Unreleased` 可以为空。
- 每个任务使用独立短期分支，按工作类型命名为 `feature/`、`fix/`、`docs/`、`refactor/`、`chore/` 或 `test/`。
- 从 `master` 创建分支，通过 PR、检查和 review 后 squash merge 回 `master`，再清理已完成分支。
- Agent 不直接 push `master`、不主动打 tag、不提交本地构建产物。

### 4. 提交规范 Conventional Commits

格式为 `<type>(<scope>): <subject>`，scope 可省略。type 使用 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore` 或 `revert`。标题简短、无结尾句号；正文说明原因与影响，footer 关联 Issue，破坏性变更标记 `BREAKING CHANGE`。

本地检查器为 `scripts/commit-msg-lint.mjs`；作者检查为 `scripts/commit-author-guard.sh`。在仓库根目录执行 `git config core.hooksPath scripts/git-hooks` 启用钩子。外部贡献者的操作说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 5. Pull Request 流程

PR 标题遵循 Conventional Commits。描述包含问题与结果、关联 Issue、验证、影响和回滚方式；界面修改附截图。使用 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)。

[CI](.github/workflows/ci.yml) 的五个 job 均须通过：

| Job | 内容 |
|---|---|
| `desktop` | 类型、离线测试、lint、文档漂移与构建 |
| `unit-test` | Vitest 与覆盖率门槛：lines 60、functions 55、branches 50 |
| `e2e` | Playwright Electron 业务与界面回归 |
| `godot-integration` | 真实 Godot 4.6.2 插件、RPC、场景与脚本检查 |
| `actionlint` | 工作流语法与表达式 |

至少完成一次 review；单维护者项目执行自审，多人协作时显式邀请 reviewer。合并前检查实际 CI 状态，不能带失败检查合并。默认 squash merge，合并后清理已完成分支。

### 6. CI 自动化

`ci.yml` 监听 `main` / `master` push 和 PR，actionlint 成功后其余四个 Windows job 并行；同一 ref 的旧运行会取消。依赖更新由 [Dependabot](.github/dependabot.yml) 发起；`dependabot-review.yml` 仅发布审阅提醒，patch 更新同样须五项 CI 全绿、至少一个有效 approve 后由维护者按依赖顺序 squash 合并。

`test:godot` 要求 PowerShell 的 `$env:GODOT_BIN` 指向真实 Godot 4.6.2 console 可执行文件；缺少环境明确失败。CI 的 `scripts/setup-godot.ps1` 下载固定版本并校验 SHA-256。测试使用隔离目录，不读写维护者真实的 Pi 偏好、会话或认证数据。

### 7. 发版流程

发版由维护者按交付价值决定，不随每个 PR 自动发生。

1. 整理 `CHANGELOG.md`：将待发内容放入非空 `## X.Y.Z` 章节，按用户影响归类。每条以用户可见行为为主，通常一至三句话；实现细节、排查过程和测试清单留在 PR。
2. 在发版分支执行 `npm run release:prepare -- X.Y.Z`，核对包版本、锁文件与更新说明。该命令不提交、推送或创建 tag；版本领先现有 tag 时先核对前次发版状态。
3. 通过 PR 合并至 `master`，完成检查与 review。
4. 维护者在合并后的 `master` 提交上创建并推送 `vX.Y.Z` tag。
5. [release.yml](.github/workflows/release.yml) 校验 tag、HEAD、包版本与非空更新说明，完成类型、lint、离线测试、覆盖率、构建、E2E、真实 Godot 和更新说明抽取检查后才打包；独立 publish job 上传 GitHub Release。

发布正文由 `scripts/extract-changelog.mjs` 生成。minor 线起点会汇总上一线全部 patch，使用 `npm run release:notes -- X.Y.Z` 预览，`--no-aggregate` 可关闭汇总。

本地 `npm run release:dist` 用于冒烟，正式发布仍由 CI 重建。`apps/desktop/release/` 不入 Git，用户下载的权威产物是 GitHub Release。代码签名配置通过 `CSC_LINK` / `CSC_KEY_PASSWORD` 或 Windows 对应环境变量提供。

### 8. 文档与社区

用户操作写在 README，开发边界写在 AGENTS，协作流程写在本文；专门主题放在对应文档，避免全文互相复制。文档职责和索引见下文。

Issue 模板位于 `.github/ISSUE_TEMPLATE/`；贡献、安全报告与社区约定分别见 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。许可证为 [MIT](LICENSE)。

### 9. 定期回顾

每周整理 Issue、PR 与依赖更新；每月核对候选方向、技术债和文档；主要依赖升级单独验证。具体维护、分支清理及发版节奏见 [维护说明](docs/maintenance.md)。

## 架构导航

### 进程与会话

- `electron/main.ts` 是薄入口，动态加载 `app-runtime.ts`。Pi SDK、文件系统、会话、供应商、插件和用量均在主进程。
- preload 暴露 `window.xAgent` 的 13 个功能分面；renderer 不直接访问 Node。新增 IPC 同步注册表、签名/DTO、handler 和 preload，具体约束见 AGENTS。
- `session-host.ts` 组合会话能力；`session-lifecycle.ts` 管理创建和替换；`session-mode/` 管理 Ask / Plan / Goal，`session-type-policy.ts` 管理 code / design。
- Pi SDK 负责模型上下文组装。`DefaultResourceLoader` 发现资源，`createAgentSession` 注册工具，事件经 `agent:event` 转为展示实录。`chat-store` 不构建第二套模型上下文。
- 切换项目、新建或恢复时先创建候选会话；失败保留当前会话和策略。撤回通过独立 Shadow Git 检查点，必要时降级 write/edit 基线。

### 供应商、插件与用量

- `provider-store.ts` 导出供应商能力，本地档案启用后才同步 Pi auth/models；关闭时处理共享 providerId。模型输入能力与上下文上限见领域词表。
- `model-fetch.ts` 使用 `public-http.ts` 探测模型，连接时校验 DNS、拒绝重定向并限制时长和响应体；Pi SDK 的其他传输未统一经过此实现。
- `plugin-host.ts` 管理资源文件，`package-manager.ts` 管理安装；资源变化后通过 `session.reload()` 生效。
- `usage-store.ts` 保存实际用量；Goal 评估费用一并入账。预算约束续轮，暂停与撤回不退还实际费用。
- 本地诊断与恢复契约见 [领域词表](docs/context.md)，具体安全和持久化约束见 AGENTS。

### Godot

当前随应用分发的 X-agent RPC addon 为 **0.6.4**。

| 位置 | 职责 |
|---|---|
| `apps/desktop/shared/godot-rpc/` | 协议类型、方法清单、工具开关映射与超时策略 |
| `apps/desktop/electron/agent/godot-rpc-bridge.ts` | 本机 TCP JSON-lines、多客户端、握手与项目路由 |
| `apps/desktop/electron/agent/godot-tools.ts` | Pi 自定义 Godot 工具 |
| `apps/desktop/electron/agent/godot-addon-install.ts` | 安装随应用分发的 addon |
| `packages/godot-editor-rpc/` | Godot 编辑器插件与连接说明 |
| `packages/godot-pi/` | 内置技能、Godot 文档、提示模板和项目检测 |

安装、协议、工具及连接排查只维护在 [Godot 插件说明](packages/godot-editor-rpc/README.md)，避免多处复制列表。

### 持久化与构建

数据位于 `~/.pi/agent/`；X-agent 的偏好、供应商、用量、会话、检查点、计划和目标记录与 Pi CLI 分开，`auth.json` / `models.json` / `settings.json` 共用。原子写、串行化和密文保护约束见 AGENTS。

`electron.vite.config.ts` 分别构建 main、preload、renderer；preload 为 sandbox 兼容的 CJS 单文件，仅运行时依赖 Electron。打包的额外资源为应用图标、Godot addon 和 godot-pi，以 `apps/desktop/package.json` 为准。

## 文档职责

| 文档 | 内容 |
|---|---|
| [README.md](README.md) / [README.en.md](README.en.md) | 用户能力、安装与使用 |
| [AGENTS.md](AGENTS.md) | 编码助手入口与必须先知道的约束 |
| [docs/agent.md](docs/agent.md) | 技术栈、验证命令与查阅入口 |
| [docs/agent-context.md](docs/agent-context.md) | 模型上下文加载与运行时维护 |
| [docs/context.md](docs/context.md) | 领域词表、模块索引与恢复契约 |
| [docs/design.md](docs/design.md) | 桌面主题、几何、布局与动效 |
| [docs/pi-plugin-guide.md](docs/pi-plugin-guide.md) | 桌面端的 Pi 资源管理与加载边界 |
| [docs/roadmap.md](docs/roadmap.md) | 后续候选方向；任务状态以 Issue / PR 为准 |
| [docs/maintenance.md](docs/maintenance.md) | 维护节奏、文档对齐与分支清理 |

`docs/` 是公开文档目录；不在其中保留个人草稿、本机记录或临时调研。文档变更在根目录执行 `npm run doc:drift` 和 `npm run test:doc-drift`。应用检查命令集中见开发与验证速查。
