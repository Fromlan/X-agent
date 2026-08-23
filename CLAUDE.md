# CLAUDE.md

给在本仓库工作的编码助手（含 Claude Code）的项目指引。

## 项目概览

X-agent 是基于 Pi SDK 的 Electron 桌面 Agent。仓库只有一个实际应用 [`apps/desktop`](apps/desktop)；根 `package.json` 不是 npm workspace，仅转发脚本。当前版本见 `apps/desktop/package.json`（如 `0.4.0`）。

**当前能力**：Agent GUI 与会话隔离、对话撤回/编辑重发/重新生成（Shadow Git 检查点优先，无 Git 降级 write/edit 基线）、**Ask/调研 Mode**（只读问答，无 `write_plan`）、**Plan Mode**（只读研究 + `write_plan` + 右栏可编辑计划 / 保存到项目 + tool_call 硬闸 + 执行计划）与 **Goal Mode**（完成条件 + 独立评估续轮）、**游戏开发四阶段工作流**（策划 / 原型 / 测试 / 扩充，项目级持久化 `<cwd>/.x-agent/stage.json`，跟随后随 git 共享）、右栏（上下文压缩 / 计划 / 工具 / 文件 / Godot / 阶段专属）、供应商订阅、用量统计、设置内插件管理（Prompt / Skill / Extension / Theme / Packages）、工具白名单（内置 + Godot 编辑器）、Godot RPC、godot-docs-4-7 技能、应用内 Pi 登录引导与打包版自动更新。

运行环境：Node.js 22+。Windows 上 Pi `bash` 需要 Git for Windows，或配置 `~/.pi/agent/settings.json` 的 `shellPath`。认证与模型复用 `~/.pi/agent/auth.json`、`models.json`（可通过设置 → 供应商写入）。

**技能发现**：`DefaultResourceLoader` 经 `skillsOverride` 排除 `~/.agents/skills`；仅用 `~/.pi/agent/skills`、项目 `.pi/skills` 与已安装 Packages。

## 常用命令

锁文件在 `apps/desktop/package-lock.json`，安装在该目录执行：

```bash
cd apps/desktop
npm install
```

根目录便捷脚本：

```bash
npm run desktop:dev            # Electron 开发
npm run desktop:build
npm run desktop:typecheck
npm run desktop:test           # 离线断言脚本
npm run desktop:smoke          # 真实模型冒烟
npm run desktop:dist           # electron-builder（Windows）
npm run desktop:reset-tutorial # 重置教程环境
npm run release:prepare -- x.y.z
npm run release:notes -- x.y.z
# minor 线起点（如 0.3.0）的 notes 会附带上一线 0.2.x 汇总；加 --no-aggregate 可关闭
npm run release:test-changelog # 可选：验证 CHANGELOG 抽取 / 汇总
npm run release:dist           # 可选：本地 typecheck + test + 打 Windows exe（冒烟）
```

### 发版流程

1. `npm run release:prepare -- x.y.z`（改版本号、校验 CHANGELOG）
2. 提交并打标签：`git tag vX.Y.Z && git push origin HEAD && git push origin vX.Y.Z`
3. [`.github/workflows/release.yml`](.github/workflows/release.yml) 在 CI 构建并上传 **GitHub Releases**（用户下载的权威产物：安装包 + `latest.yml`；勿提交 `apps/desktop/release/`）
4. （可选）打 tag 前本机 `npm run release:dist` 冒烟；CI 仍会重建，本地 exe 不是发布源
5. Windows 代码签名（可选）：本地或 Actions 设置 `CSC_LINK` + `CSC_KEY_PASSWORD`（或 `WIN_CSC_LINK`）；未设置则产出未签名包

`npm test`（在 `apps/desktop`）串联：

`test-history-mapper`、`test-transcript-golden`、`test-turn-file-tracker`、`test-session-bind-timing`、`test-session-paths`、`test-session-title`、`test-plan-mode-tools`、`test-plan-mode-guard`、`test-bash-readonly`、`test-bash-liveness`、`test-goal-evaluator`、`test-session-mode-controller`、`test-session-mode-smoke`、`test-plan-todos`、`test-plan-clarify`、`test-chat-store`、`test-group-sessions`、`test-plugin-host`、`test-provider-store`、`test-provider-activate`、`test-provider-last-enabled`、`test-auth-cache-invalidation`、`test-model-fetch`、`test-model-context`、`test-godot-addon-install`、`test-pi-cli`、`test-model-runtime-reload`、`test-package-manager`、`test-context-breakdown`、`test-cache-hit`、`measure-context-baseline`、`test-debug-log`、`test-error-i18n`、`test-exclude-agents-home-skills`、`test-skill-slash`、`test-user-message-files`、`test-chat-scroll-pin`、`test-chat-transcript-virtual`、`test-chat-markdown-streaming`、`test-chat-scroll-throttle`、`test-chat-virtual-cache`、`test-debug-mode`、`test-select-menu-scroll`、`test-tool-card-collapse`、`test-tool-batches`、`test-confirm-provider`、`test-prefs-defaults`、`test-prefs-recovery`、`test-update-feed`、`test-update-feed-resolve`、`test-session-host-helpers`、`test-session-slash-items`、`test-prompt-slash-wrap`、`test-extension-ui`、`test-session-event-bridge-stale`、`test-external-url`、`test-ready-checklist`、以及 `packages/godot-pi/scripts/check-skills.mjs`。

> 0.4.0 起 cwd-sandbox / usage-store / godot-rpc-bridge / shadow-checkpoints 的覆盖已收敛到 Vitest（`*.test.ts`），不再双写离线脚本。

冒烟（需本机认证）：

```bash
npm exec --prefix apps/desktop -- tsx scripts/smoke-session.ts "D:\path\to\project"
```

## 架构

Electron 三进程边界：

- `electron/main.ts`：注册 IPC；持有 `SessionHost`、`GodotRpcBridge`、`AppAutoUpdater`。Pi SDK / 文件系统 / 会话 / 模型 / 供应商 / 插件 / 用量 / 文档检索均在主进程。
- `electron/preload.ts`：`contextBridge` 暴露 `window.xAgent`。`contextIsolation` 开、`nodeIntegration` 关、主窗口 **`sandbox: true`**（preload 为 CJS 单文件，仅依赖 electron 受限 API）；新增能力需同步改 `shared/ipc.ts`、main handler、preload。
- `src/`：React renderer。`App.tsx` 组合顶栏、侧栏、聊天、可选右栏、设置弹窗、撤回确认。不直接依赖 Pi SDK。新代码优先走分面（`workspace` / `turn` / `plan` / `session` / `prefs` / …）；扁平方法仅作兼容。
- `shared/ipc.ts`：跨进程协议源；`shared/godot-rpc.ts`：Godot TCP 协议。

### UI 壳层

| 区域 | 要点 |
|---|---|
| TopBar | 打开项目 / 新会话、设置、右栏开关、主题、状态 |
| Sidebar | 按项目分组会话；重命名 / 删除；「从侧栏移除」写 `hiddenProjectKeys` |
| Chat | 流式、steer、中止；撤回 / 编辑重发 / 重新生成；`@路径` 展开；底部工具条承载模式（智能体 / 调研 / 计划 / 目标）、模型 / Thinking / 展示思考、发送 |
| RightPanel | 上下文（占用拆解 + 手动压缩）、工具、文件树、Godot 桥状态 |
| Settings | 通用 / 供应商 / 用量 / 工具 / 插件 / Godot（编辑器连接） |

### Agent 与事件

[`session-host.ts`](apps/desktop/electron/agent/session-host.ts) 编排单会话：

1. `ModelRuntime` 从 auth / models 初始化模型。
2. `DefaultResourceLoader` 以项目 `cwd` 加载 skills / extensions 等；`skillsOverride` 排除 `~/.agents/skills`。
3. `createAgentSession`：`tools` 注册 `ALL_TOGGLEABLE_TOOLS`，`setActiveToolsByName(prefs.tools)`；`customTools` 含 Godot RPC + Godot docs。
4. Pi 事件转为 `UiAgentEvent`，经 `agent:event` 推到 renderer。
5. Renderer 用 [`chat-store.ts`](apps/desktop/src/stores/chat-store.ts) `applyAgentEvent` 归并；恢复时 `shared/transcript` 的 branch mapper 映射为同一 `HistoryItem` 结构。
6. 用量经 `usage_update` / `usage-store`；右栏可 `compactSession` → `session.compact()`。
7. `session_info` / status / prefs（如 `lastSessionPath`）写入顶栏与偏好。

### 游戏开发四阶段工作流

每个项目（cwd）持久化一个当前阶段到 `<cwd>/.x-agent/stage.json`（跟随 git 共享）。阶段作为"项目级工作流层"叠加在现有会话级 mode（智能体 / 调研 / 计划 / 目标）之上：

| 阶段 | 标识 | 默认 mode | 工具白名单 | 阶段产物 | 毕业条件（建议不强制） |
|---|---|---|---|---|---|
| 策划 | `design` | plan | 只读 + write_plan | `.x-agent/design/`（GDD.md / 数据表） | GDD + 数据表 + 核心玩法段落 |
| 原型 | `prototype` | agent | 写工具 + Godot 写类 | `.x-agent/prototype/`（NOTES.md） | main scene + 核心循环脚本 + 引用过 GDD |
| 测试 | `test` | agent | Godot 调试/内省 + 受限 edit | `.x-agent/test/`（bugs.md / playtest-checklist.md） | 玩通 1 轮 + ≥3 个 bug 已修复 |
| 扩充 | `expand` | agent | 全部 | `.x-agent/expand/`（backlog.md） | 无 |

**关键模块**：
- `shared/stage.ts` / `shared/stage-defs.ts` / `shared/stage-prompt.ts` / `shared/stage-tools.ts` —— 数据模型、静态定义、system append、工具白名单派生
- `electron/agent/stage/` —— `StageController` + `persistence`（原子写） + `graduation`（4 类检查：file-exists / file-count / glob-count / manual）+ `artifacts`（首次进入阶段时建默认模板）
- `shared/stage-tools.ts:computeStageTools` —— 在现有 mode 派生之上叠加阶段（ask/plan 始终只读；design 阶段即使是 agent 模式也限制为只读；agent + prototype/test/expand 自动追加 Godot 写/调试工具集）
- `electron/agent/filter-stage-skills.ts` —— 阶段化 skill 过滤层（design 屏蔽 `gdscript-*` / `godot-tscn` 等；prototype 屏蔽 `godot-asset-path`）
- `electron/agent/session-host.ts:onStageChanged` —— 阶段切换后重算工具白名单 + 注入 stage.append 到 system prompt 头部 + 推送 `stage:changed` 事件给 renderer
- `src/components/StageBar.tsx` —— 顶栏 4 步进度条（icon + label + 毕业进度）
- `src/components/StageSwitchModal.tsx` —— 阶段切换弹窗（毕业清单 + 警告 + 手动勾选 manual 项）
- `src/components/right-panel/{Design,Prototype,Test}Tab.tsx` —— 阶段专属右栏 tab

**重要约束**：
- 现有 4 mode 完全不破坏；阶段是叠加在 mode 之上的"工作流节点"
- 阶段切换在流式中拒绝（`isStreaming` 保护，沿用 mode 切换的语义）
- 毕业条件**建议但不强制**（用户明确选择）；手动勾选 manual 项后立即持久化
- 阶段切换时自动同步默认 mode（如切到 prototype → 切到 agent 模式）
- 阶段文件 < cwd >/.x-agent/stage.json 跟随 git，团队成员 clone 后阶段状态共享

流式中再次 prompt 使用 `streamingBehavior: "steer"`。切换项目 / 新会话 / 恢复前释放当前 session。会话自动标题：[`session-title.ts`](apps/desktop/electron/agent/session-title.ts)。撤回：`navigateTree` + Shadow Git 检查点（[`shadow-git.ts`](apps/desktop/electron/agent/shadow-git.ts) / [`shadow-checkpoints.ts`](apps/desktop/electron/agent/shadow-checkpoints.ts)，**按 diff 路径还原**，不整库 reset）；无 Git 时降级 [`turn-file-tracker.ts`](apps/desktop/electron/agent/turn-file-tracker.ts)。

上下文组装细节见 [`AGENT_CONTEXT.md`](AGENT_CONTEXT.md)。

### 供应商

- `provider-store.ts` → `~/.pi/agent/x-agent-providers.json`；档案保存到本地，**启用**才同步 Pi `auth.json` / `models.json` 并出现在顶栏；关闭则从 Pi 摘掉（无其它启用档案共用 providerId 时）
- `model-fetch.ts`：探测 `/v1/models` 等；IPC `fetchProviderModels`。**SSRF 闸**：`baseUrl` 与模型探测仅允许公网 http(s)（回环 / 私网 / 链路本地 / 已知 DNS 重绑定域一律拒绝，域名再做 DNS 解析校验）；本地 LLM 需经公网代理中转
- UI：设置 → 供应商（每张档案有启用开关）

### 插件与 Packages

- `plugin-host.ts`：Prompt / Skill / Extension / Theme（全局与项目 `.pi`）
- `package-manager.ts`：`pi install` / `pi uninstall` + `x-agent-packages.json`；一键安装 `godot-pi`
- UI：设置 → 插件（[`PluginsPage.tsx`](apps/desktop/src/components/PluginsPage.tsx)）

### Godot RPC 与文档

| 组件 | 路径 |
|---|---|
| 协议 | `apps/desktop/shared/godot-rpc.ts` |
| 桥接 | `electron/agent/godot-rpc-bridge.ts`（多客户端 id / 活动选路；启动优先复用上次 endpoint 的 token+端口） |
| 编辑器工具 | `electron/agent/godot-tools.ts`（`GODOT_TOOLS`，默认关） |
| 惯例技能 | `packages/godot-pi/skills/godot-docs-4-7`（仅 Godot 项目索引） |
| Addon 安装 | `electron/agent/godot-addon-install.ts` |
| Addon | `packages/godot-editor-rpc`（0.6.2：endpoint mtime 轮询、`editor_ready` 上报 addonVersion、场景内省 / 调试器 / 资源治理 / 导出 / 配置读写 / 只读内省全套工具；lint 子进程走子线程、只读捕获不切换编辑场景、序列化 5000 节点预算） |

要点：默认端口 `8765`（回退 `8765–8774`），endpoint 写入 `x-agent-godot-rpc.json`（`{host,port,token,version,updatedAt}`）；`stop()` 不再删除 endpoint —— 残留文件让下次启动复用旧 token，已运行的 Godot 插件无需重装即可恢复。`run_current_scene` / `play_main_scene` 短时收集报错；`import_resources` 扫描或按路径 reimport。就绪清单的 `rpcBridge` 状态分五态（宽限中 / 已连接 / 握手失败 → 引导更新插件 / 未启动 / 启动编辑器）。设置入口：**设置 → Godot → 编辑器连接**。详见 [`packages/godot-editor-rpc/README.md`](packages/godot-editor-rpc/README.md)。

### 用量与上下文面板

- `context-breakdown.ts`：右栏组成拆解（含协议损耗）
- `usage-store.ts` → `~/.pi/agent/x-agent-usage.json`
- UI：右栏「上下文」；设置 → 用量

### 认证与自动更新

- `auth-check.ts` / `pi-cli.ts`（含 `openPiLogin`）
- `auto-updater.ts` / `update-feed.ts`：仅打包版启用 `electron-updater`，`provider: "github"` → `Fromlan/X-agent` Releases；启动后静默检查（不自动下载），有更新时应用内提示条 + 顶栏角标引导下载/安装；设置可「打开 Releases」回退
- UI：设置 → 通用 → 检查 / 下载 / 安装更新；顶栏角标；`loadPrefsWithRecovery` 损坏偏好备份提示
- 安全说明见 README「安全与隐私」；临时只读用会话「调研」/ Plan（硬闸关闭 write/edit，bash 仅放行只读命令且路径须落在项目 cwd 内；`read`/`grep`/`find`/`ls`/`godot_detect_project` 的路径参数同样强制 cwd 内；`godotRpcRequest` 在 IPC 层校验工具开关）

### 持久化与隔离

| 路径 | 用途 |
|---|---|
| `~/.pi/agent/x-agent.json` | 客户端偏好 |
| `~/.pi/agent/x-agent-providers.json` | 供应商档案（API Key 尽量 `safeStorage` 加密；启用时明文同步写入 Pi `auth.json`；**解密失败保留密文 `encryptedKey`，保存不覆写**） |
| `~/.pi/agent/x-agent-godot-rpc.json` | Godot RPC endpoint（host/port/token/version/updatedAt；`stop()` 不再删除，下次启动复用） |
| `~/.pi/agent/x-agent-packages.json` | Packages 安装记录 |
| `~/.pi/agent/x-agent-usage.json` | 用量汇总 |
| `<cwd>/.x-agent/stage.json` | 项目级游戏开发阶段（current / history / manualChecks；**跟随 git**，团队共享） |
| `~/.pi/agent/x-agent/sessions/` | 本应用会话 |
| `~/.pi/agent/x-agent/checkpoints/` | Shadow Git 工作区检查点（按项目隔离） |
| `~/.pi/agent/x-agent/plans/` | Plan Mode 默认写出的 Markdown 计划（可「保存到项目」迁至 `<cwd>/.pi/plans/`） |
| `~/.pi/agent/x-agent/goals/` | Goal Mode 跨恢复日记（按 session 路径哈希） |
| `auth.json` / `models.json` | Pi 认证与模型（密钥明文，与 Pi CLI 共用） |

会话列表只读 X-agent 会话目录；恢复须拒绝目录外路径。

### 构建

`electron.vite.config.ts`：main `electron/main.ts`、preload `electron/preload.ts`、renderer `index.html`。  
**preload 构建特例**（sandbox 兼容）：`externalizeDeps: false` + 仅 external `electron` + CJS 单文件（`index.cjs`）——typebox / shared 常量内联，改 preload 依赖时不得引入需运行时 require 的包。  
`tsconfig.node.json` 查 Electron / shared；`tsconfig.web.json` 查 React / shared。别名：`@/`、`@shared/`（Node 侧仅 `@shared/`）。  
打包 `extraResources`：Godot addon + `godot-pi`。

## UI 约束

以 [`DESIGN.md`](DESIGN.md) 为准（Cindy 近单色扁平语言）：

- 深色默认；浅色 `body[data-theme="light"]`
- Surface / Card / Board + 语义色 token；组件与 JS 不硬编码色值
- Inter + JetBrains Mono，约 13px；1px Board 边框；页面内无阴影（modal 除外）
- Pill 交互几何（按钮 / chip / 单行 input）；容器 12px；多行 8px
- 图标用 `lucide-react`，不用 emoji 充当 UI 图标
- focus 用 `--focus-ring-soft`；尊重 `prefers-reduced-motion`
- 设置：左侧分页 + 可滚动内容区（`min-height: 0` + `overflow-y: auto`）

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `Fromlan/X-agent` (via `gh`): `gh issue list --repo Fromlan/X-agent`.

### Triage labels

Canonical roles use matching label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). 用 `gh issue list --label <name> --repo Fromlan/X-agent` 过滤。

### Domain docs

Single-context: root [`CONTEXT.md`](CONTEXT.md) 描述了核心架构与持久化路径(对应 ADR 摘要)。

本地 `docs/` 仅供个人维护 ADR / 调研 / code-review 草稿(已被 `.gitignore` 排除,不入 git 也不发布):

- `docs/adr/*.md` — 单条 ADR(对应于 git 历史 commit 摘要,新决策请直接补到本文或 CONTEXT.md)
- `docs/agents/{domain,issue-tracker,triage-labels}.md` — 给 skills 读的领域/协作规则,与本节同步更新
- `docs/Godot-Tileset-结构格式调研.md` 与 `docs/research-plan-goal-modes.md` — 历史调研沉淀
- `docs/code-review-2026-08-01.md` — 0.3.8 全量审查,分诊结论已落入 CHANGELOG 与 ADR

约定:对外约定请写在本 `CLAUDE.md` 或 `CONTEXT.md`;`docs/` 内容不进 release、不参与协作,清理后下次会话可重建。
