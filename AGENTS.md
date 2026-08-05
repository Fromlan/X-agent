# AGENTS.md

> OpenCode 在本仓库工作时的入口指引。只记录「不查就会猜错 / 容易踩坑」的事实，不再重复各文档全文。
> 更完整的指引：开发者向 `CLAUDE.md`、模型上下文原理 `AGENT_CONTEXT.md`、领域词表 `CONTEXT.md`、设计规范 `DESIGN.md`。
> 注意：Pi SDK 会把 `AGENT.md`、`CONTEXT.md`、`CLAUDE.md` **全文**注入到模型的项目上下文（见 `AGENT_CONTEXT.md` 第 3 节）——改它们会影响 Agent 实际看到的内容。

## 仓库结构（先记住这两点）

- 只有一个实际应用：`apps/desktop`（Electron 三进程：`electron/main.ts` 主进程 / `electron/preload.ts` / `src/` renderer / `shared/`）。根 `package.json` **仅转发脚本**，无依赖、无 lockfile，且**没有 `test` 脚本**——在根目录跑 `npm test` 会失败。
- 权威版本号在 `apps/desktop/package.json`；其余目录：`packages/godot-editor-rpc`（Godot 4.x 编辑器插件）、`packages/godot-pi`（X-agent 原生 Pi Package）、`scripts/`（发版工具）、`.github/workflows/`（CI/release）。
- 本项目定位是 **Godot 4 专用** Agent：同一会话改场景/脚本 + 经编辑器 RPC 驱动 Godot + 查 godot-docs-4-7 知识库。

## 常用命令（依赖与锁文件在 `apps/desktop`）

安装、测试、类型检查都必须在 `apps/desktop` 目录内执行：

```bash
cd apps/desktop
npm install
npm run typecheck        # tsc 两个 tsconfig：tsconfig.node.json + tsconfig.web.json
npm test                 # 离线断言链：约 56 个 tsx 脚本串行（无需认证，见下）
npm run test:unit        # vitest（node 环境，含 src/lib 纯逻辑；覆盖率门槛见 vitest.config.ts）
npm run dev              # electron-vite dev（renderer 固定 127.0.0.1:5173，strictPort）
npm run debug            # 同上但置 X_AGENT_DEBUG=1
npm run dist             # electron-builder --win（NSIS + portable）
```

根目录等价转发脚本：`npm run desktop:dev|build|typecheck|test|dist|smoke|reset-tutorial`，以及 `release:prepare|notes|test-changelog|dist`。发版由 maintainer 执行，Agent 不要主动打 tag / 提交 `apps/desktop/release/`（构建产物，CI 的 GitHub Releases 才是权威发布源）。

真实模型冒烟：`npm run desktop:smoke`（需本机 Pi 认证，`~/.pi/agent/auth.json`），不是 CI 检查。

## 测试：两种范式，别搞混

- `apps/desktop/scripts/test-*.ts` = 离线断言脚本，由 `npm test` **串行串联**（`&&`）。命名为 `test-*.ts` 的不属于 vitest。
- `*.test.ts`（`electron/**`、`shared/**`、`src/**`）= vitest 单测（`npm run test:unit`），CI 有覆盖率门槛。
- 跑单个离线脚本：`npx tsx scripts/test-xxx.ts`；**renderer 相关脚本必须加 `--tsconfig tsconfig.web.json`**（如 `test-chat-*`、`test-plan-todos`、`test-skill-slash` 等，脚本名含 `web.json` 标志的不逐一列举——看 `package.json` 的 `test` 脚本为准）。
- 改 Godot 相关代码跑 `test-godot-addon-install`（bridge 协议已被 `electron/agent/godot-rpc-bridge.test.ts` 的 vitest 独占覆盖）；改模式/沙箱跑 `test-plan-mode-tools` / `test-plan-mode-guard` / `test-bash-readonly`（沙箱边界由 `cwd-sandbox.test.ts` / `project-fs.test.ts` 覆盖）；`npm test` 结尾还会跑 `packages/godot-pi/scripts/check-skills.mjs` 校验技能目录。

## 架构约束（改代码前必读）

- 三进程边界：Pi SDK / 文件系统 / 会话 / 模型 / 供应商 / 插件 / 用量 / 文档检索**全在主进程**；renderer 只能经 `window.xAgent.*` 调用，**禁止直接访问 Node API**（`contextIsolation` 开、`nodeIntegration` 关）。
- **新增/改名 IPC 必须同步四处**：`shared/ipc-channels.ts`（channel 名注册表）+ `shared/ipc.ts`（类型）+ `electron/ipc/register-*-ipc.ts`（handler，按模块挂：session / session-config / provider / godot / update，其余在 `app-runtime.ts` 的 `registerIpc()`）+ `electron/preload.ts`（bridge）。`window.xAgent` 实际暴露 6 个分面对象（workspace/turn/plan/session/prefs/updates）+ flat 方法；新代码优先走分面，扁平方法仅作兼容。
- 上下文组装由 Pi SDK（`@earendil-works/pi-coding-agent`）完成，**不要手写 system prompt**。
- 别名：renderer 用 `@/` → `src`、`@shared/` → `shared`；Node 侧仅 `@shared/`。`main.ts` 是薄入口，重逻辑动态 import `app-runtime`。

## 会话模式与工具硬闸（安全边界，别放松）

- Agent / Ask（调研）/ Plan / Goal 四种模式互斥，切换时硬闸重排工具集。
- Ask 与 Plan **只读**：关 `write` / `edit`（Ask 还关 `write_plan`）；bash 仅放行只读命令且路径须落在项目 cwd 内。**Ask 模式不写回设置**。
- 工具常量：`shared/mode-tools.ts`；模式提示：`shared/mode-prompt.ts`；只读 bash 过滤：`electron/agent/session-mode/bash-readonly.ts`（拒 `$()` / 反引号 / `{}`；`godot` / `dotnet` 不算只读）。
- CWD 沙箱：`electron/agent/cwd-sandbox.ts`（拒绝逃出 cwd，Windows 大小写归一）。Agent 模式下 Pi `bash` 仍可访问更广路径——不要承诺绝对安全。

## 持久化与撤回

- 数据全在 `~/.pi/agent/`：`x-agent.json`（prefs）、`x-agent-providers.json`（API Key 尽量 `safeStorage` 加密）、`x-agent-usage.json`、`x-agent-godot-rpc.json`、`x-agent/sessions/`、`x-agent/checkpoints/`、`x-agent/plans/`、`x-agent/goals/`。与 Pi CLI **共用** `auth.json` / `models.json`，其余隔离。
- prefs / usage / provider / auth / godot-rpc **必须原子写**（`electron/agent/lib/atomic-write.ts` tmp+rename）；prefs / usage 走 `withStoreLock` 串行化。
- 撤回走 `retract-orchestrator.ts`：优先 Shadow Git 检查点（`shadow-git.ts` + `shadow-checkpoints.ts`，独立 `GIT_DIR=` 指向 `~/.pi/agent/x-agent/checkpoints/`，**不污染用户 `.git`**）；无 Git 降级 `turn-file-tracker.ts`。
- 关键时序：Pi 在 `message_end` 之后才 `appendMessage`——active user / Shadow pre **必须在该 append 之后绑定**（`tool_execution_start` / `queueMicrotask`），不能在 `message_start` 取 leaf。

## 技能与插件

- 技能发现由 Pi `DefaultResourceLoader` 完成；**故意排除 `~/.agents/skills`**（`exclude-agents-home-skills.ts`），仅 `~/.pi/agent/skills`、项目 `.pi/skills`、已安装 Packages。
- 改完技能 / 插件后必须 `session.reload()` 才会重新发现。
- `packages/godot-pi` 是内置 Package（Core 技能 + `godot-docs-4-7` 文档技能 + prompts + `godot_detect_project` 工具）。

## Godot 集成

- RPC 桥 `electron/agent/godot-rpc-bridge.ts`：默认端口 8765（回退 8765–8774），仅监听 127.0.0.1，握手 token 校验；`GODOT_TOOLS` 默认**关闭**，需在 设置 → 工具 勾选。
- 协议 `shared/godot-rpc.ts`；addon 在 `packages/godot-editor-rpc/addons/x_agent_rpc/`。`x-agent-godot-rpc.json` 残留是特性（下次启动复用旧 token，插件无需重装），`stop()` 不删。
- `run_current_scene` / `play_main_scene` 短时收集报错，插件不因报错自动停止。

## 环境与其他坑

- 仅 Windows 在开发/CI 矩阵（Node 22+，CI 为 windows-latest）。
- Pi `bash` 在 Windows 需要 Git for Windows，或配置 `~/.pi/agent/settings.json` 的 `shellPath`。
- `docs/` 与 `.scratch/` 被 `.gitignore` 排除，**不入 git 也不参与协作**——对外约定写 `CLAUDE.md` / `AGENT.md` / `CONTEXT.md`，不要写进 `docs/`。
- 仓库目前没有 `opencode.json`。

## 编码与 UI 约定（与框架默认不同之处）

- TypeScript 严格模式；生成代码时**加函数级注释**（新模块头部一句「做什么 + 为什么」）；注释/标识符以英文为主，用户面文案以 `README.md` / 设置页中文为准。
- 主题颜色 / 圆角 / 阴影全走 CSS 变量（`apps/desktop/src/styles/themes.css`），**组件 / JS 禁止硬编码**色值；图标用 `lucide-react` 不用 emoji；字重仅 400 / 500。
- 几何：按钮 / chip / 单行 input 用 pill（`9999px`）；容器 12px、多行 8px；1px Board 边框；页面内无阴影（modal 除外）。设置页内容区需 `min-height: 0` + `overflow-y: auto`。
- 完整规范见 `DESIGN.md`（深色默认，`body[data-theme]` 覆盖浅色）。

## 提交前自检

- 在 `apps/desktop` 内：`npm run typecheck` + `npm test`（CI 会再跑一遍 + vitest 覆盖率）。
- 不要提交：`docs/`、`.scratch/`、`apps/desktop/release/`、`out/`。
