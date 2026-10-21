# 开发与验证速查

本页只维护技术栈、验证命令和查阅入口。编码边界见 [AGENTS.md](../AGENTS.md)，协作与发布流程见 [CLAUDE.md](../CLAUDE.md)，模型上下文规则见 [agent-context.md](agent-context.md)。本页不会自动进入模型上下文。

## 技术栈

依赖声明以 [apps/desktop/package.json](../apps/desktop/package.json) 为准，实际安装版本由同目录锁文件确定；以下声明由 `npm run doc:drift` 核对。

- electron-vite ^6.0.0
- Vite ^8.3.4
- @earendil-works/pi-coding-agent ^0.99.2
- Electron 43、React 19、TypeScript 7；开发环境 Node.js 24+。
- 当前开发与发布平台为 Windows；真实编辑器集成检查固定 Godot 4.7.2。

## 验证命令

安装、类型检查与应用测试均在 `apps/desktop` 运行。根目录仅提供转发脚本，没有 `test` 脚本。

| 命令 | 验证内容 | 条件 |
|---|---|---|
| `npm install` | 安装应用依赖 | 锁文件位于当前目录；CI 使用 `npm ci` |
| `npm run typecheck` | 主进程与 renderer 两套 TypeScript 检查，含未使用声明检查 | 无需模型认证 |
| `npm run lint` | Babel AST 规则与发布工作流门禁 | 无需模型认证 |
| `npm test` | 离线断言、上下文基线与技能目录校验 | 无需模型认证 |
| `npm run test:unit` | Vitest 单元测试 | 与离线断言脚本分开执行 |
| `npm run test:coverage` | Vitest 与覆盖率门槛 | CI 必跑 |
| `npm run build` | 构建 Electron 应用 | E2E 的前置步骤 |
| `npm run test:e2e` | Playwright Electron 业务与界面回归 | 先构建 |
| `npm run test:godot` | 真实 Godot 插件、RPC、场景和脚本检查 | PowerShell 的 `$env:GODOT_BIN` 指向 Godot 4.7.2 console 可执行文件；缺少环境明确失败 |

`npm test` 当前为 60 个 test-* + 1 个 measure-context-baseline + 1 个 godot-pi/scripts/check-skills.mjs = 62 步串联。完整顺序只维护在 `package.json:scripts.test`。

测试文件分两类：`scripts/test-*.ts` 是独立离线断言脚本；`*.test.ts` 属于 Vitest。单独运行 renderer 相关离线脚本时，沿用 `scripts.test` 中的 `--tsconfig=tsconfig.web.json` 参数。

文档修改在仓库根目录执行 `npm run doc:drift` 与 `npm run test:doc-drift`。真实模型冒烟通过根目录 `npm run desktop:smoke` 运行，需要本机 Pi 认证，不属于离线检查。

## 运行与打包

| 根目录命令 | 用途 |
|---|---|
| `npm run desktop:dev` | 启动开发应用，renderer 固定使用 `127.0.0.1:5173` |
| `npm run desktop:debug` | 启动开发应用并启用调试日志 |
| `npm run desktop:dist` | 生成 Windows NSIS 安装包 |
| `npm run release:prepare -- X.Y.Z` | 准备版本与更新说明 |
| `npm run release:notes -- X.Y.Z` | 预览 GitHub Release 正文 |
| `npm run release:test-changelog` | 校验更新说明抽取 |

`dev` / `debug` 启动前会调用 Electron 官方安装程序，检查当前依赖版本的运行时；缺少二进制或路径文件时自动下载并校验，完整安装则直接通过。首次下载需要网络。

本地产物用于验证；正式发布源是 CI 的 GitHub Release。不提交 `apps/desktop/release/`、`out/`、测试产物或本机认证数据。

## 按问题查阅

| 内容 | 入口 |
|---|---|
| 产品能力与使用步骤 | [中文 README](../README.md)、[English README](../README.en.md) |
| 编码前必须知道的边界 | [AGENTS.md](../AGENTS.md) |
| 分支、提交、PR 与发布 | [CLAUDE.md](../CLAUDE.md)、[贡献指南](../CONTRIBUTING.md) |
| 会话、模式、供应商等概念 | [领域词表](context.md) |
| 上下文加载、技能与压缩 | [Agent 上下文说明](agent-context.md) |
| Godot 安装、连接与工具 | [Godot 插件说明](../packages/godot-editor-rpc/README.md) |
| Pi 扩展与内置技能包 | [Pi 扩展指南](pi-plugin-guide.md)、[godot-pi](../packages/godot-pi/README.md) |
| UI 主题与布局 | [设计系统](design.md) |
| 日常维护与分支清理 | [维护说明](maintenance.md) |
