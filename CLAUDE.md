# CLAUDE.md

给在本仓库工作的编码助手（含 Claude Code）的项目指引。

## 项目概览

X-agent 是基于 Pi SDK 的 Electron 桌面 Agent。仓库只有一个实际应用 [`apps/desktop`](apps/desktop)；根 `package.json` 不是 npm workspace，仅转发脚本。当前版本见 `apps/desktop/package.json`（如 `0.3.1`）。

**当前能力**：Agent GUI 与会话隔离、对话撤回/编辑重发/重新生成（Shadow Git 检查点优先，无 Git 降级 write/edit 基线）、右栏（上下文压缩 / 工具 / 文件 / Godot）、供应商订阅、用量统计、设置内插件管理（Prompt / Skill / Extension / Theme / Packages）、工具白名单（内置 + Godot 编辑器 + Godot 文档）、Godot RPC、官方文档离线检索、应用内 Pi 登录引导与打包版自动更新。

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
npm run release:dist           # 发版前本地 typecheck + test + 打 Windows exe
```

### 发版流程

1. `npm run release:prepare -- x.y.z`（改版本号、校验 CHANGELOG）
2. `npm run release:dist`（本地 typecheck、测试，并用 electron-builder 产出安装包；产物在 `apps/desktop/release/`，如 `X-agent-x.y.z-x64.exe`）
3. 提交并打标签：`git tag vX.Y.Z && git push origin HEAD && git push origin vX.Y.Z`
4. [`.github/workflows/release.yml`](.github/workflows/release.yml) 在 CI 再构建并上传 **GitHub Releases**（勿提交 `apps/desktop/release/` 产物）
5. Windows 代码签名（可选）：本地或 Actions 设置 `CSC_LINK` + `CSC_KEY_PASSWORD`（或 `WIN_CSC_LINK`）；未设置则产出未签名包

`npm test`（在 `apps/desktop`）串联：

`test-history-mapper`、`test-turn-file-tracker`、`test-shadow-git`、`test-session-bind-timing`、`test-session-paths`、`test-session-title`、`test-chat-store`、`test-group-sessions`、`test-plugin-host`、`test-provider-store`、`test-provider-activate`、`test-model-fetch`、`test-model-context`、`test-godot-rpc-bridge`、`test-godot-docs`、`test-pi-cli`、`test-model-runtime-reload`、`test-package-manager`、`test-context-breakdown`、`test-cache-hit`、`measure-context-baseline`、`test-usage-store`、`test-exclude-agents-home-skills`、`test-skill-slash`、`test-chat-scroll-pin`、`test-prefs-defaults`、`test-prefs-recovery`、`test-update-feed`、`test-update-feed-resolve`、`test-session-host-helpers`、`test-cwd-sandbox`、`test-ready-checklist`、以及 `packages/godot-pi/scripts/check-skills.mjs`。

冒烟（需本机认证）：

```bash
npm exec --prefix apps/desktop -- tsx scripts/smoke-session.ts "D:\path\to\project"
```

## 架构

Electron 三进程边界：

- `electron/main.ts`：注册 IPC；持有 `SessionHost`、`GodotRpcBridge`、`AppAutoUpdater`。Pi SDK / 文件系统 / 会话 / 模型 / 供应商 / 插件 / 用量 / 文档检索均在主进程。
- `electron/preload.ts`：`contextBridge` 暴露 `window.xAgent`。`contextIsolation` 开、`nodeIntegration` 关；新增能力需同步改 `shared/ipc.ts`、main handler、preload。
- `src/`：React renderer。`App.tsx` 组合顶栏、侧栏、聊天、可选右栏、设置弹窗、撤回确认。不直接依赖 Pi SDK。
- `shared/ipc.ts`：跨进程协议源；`shared/godot-rpc.ts`：Godot TCP 协议。

### UI 壳层

| 区域 | 要点 |
|---|---|
| TopBar | 打开项目 / 新会话、模型、Thinking、设置、右栏开关、主题、状态 |
| Sidebar | 按项目分组会话；重命名 / 删除；「从侧栏移除」写 `hiddenProjectKeys` |
| Chat | 流式、steer、中止；撤回 / 编辑重发 / 重新生成；`@路径` 展开 |
| RightPanel | 上下文（占用拆解 + 手动压缩）、工具、文件树、Godot 桥状态 |
| Settings | 通用 / 供应商 / 用量 / 工具 / 插件 / Godot（编辑器连接 · 官方文档） |

### Agent 与事件

[`session-host.ts`](apps/desktop/electron/agent/session-host.ts) 编排单会话：

1. `ModelRuntime` 从 auth / models 初始化模型。
2. `DefaultResourceLoader` 以项目 `cwd` 加载 skills / extensions 等；`skillsOverride` 排除 `~/.agents/skills`。
3. `createAgentSession`：`tools` 注册 `ALL_TOGGLEABLE_TOOLS`，`setActiveToolsByName(prefs.tools)`；`customTools` 含 Godot RPC + Godot docs。
4. Pi 事件转为 `UiAgentEvent`，经 `agent:event` 推到 renderer。
5. Renderer 用 [`chat-store.ts`](apps/desktop/src/stores/chat-store.ts) `applyAgentEvent` 归并；恢复时 `history.ts` 映射为同一 `HistoryItem` 结构。
6. 用量经 `usage_update` / `usage-store`；右栏可 `compactSession` → `session.compact()`。
7. `session_info` / status / prefs（如 `lastSessionPath`）写入顶栏与偏好。

流式中再次 prompt 使用 `streamingBehavior: "steer"`。切换项目 / 新会话 / 恢复前释放当前 session。会话自动标题：[`session-title.ts`](apps/desktop/electron/agent/session-title.ts)。撤回：`navigateTree` + Shadow Git 检查点（[`shadow-git.ts`](apps/desktop/electron/agent/shadow-git.ts) / [`shadow-checkpoints.ts`](apps/desktop/electron/agent/shadow-checkpoints.ts)）；无 Git 时降级 [`turn-file-tracker.ts`](apps/desktop/electron/agent/turn-file-tracker.ts)。

上下文组装细节见 [`AGENT_CONTEXT.md`](AGENT_CONTEXT.md)。

### 供应商

- `provider-store.ts` → `~/.pi/agent/x-agent-providers.json`；启用时写 Pi auth / models
- `model-fetch.ts`：探测 `/v1/models` 等；IPC `fetchProviderModels`
- UI：设置 → 供应商

### 插件与 Packages

- `plugin-host.ts`：Prompt / Skill / Extension / Theme（全局与项目 `.pi`）
- `package-manager.ts`：`pi install` / `pi uninstall` + `x-agent-packages.json`；一键安装 `godot-pi`
- UI：设置 → 插件（[`PluginsPage.tsx`](apps/desktop/src/components/PluginsPage.tsx)）

### Godot RPC 与文档

| 组件 | 路径 |
|---|---|
| 协议 | `apps/desktop/shared/godot-rpc.ts` |
| 桥接 | `electron/agent/godot-rpc-bridge.ts`（多客户端 id / 活动选路） |
| 编辑器工具 | `electron/agent/godot-tools.ts`（`GODOT_TOOLS`，默认关） |
| 文档工具 | `electron/agent/godot-docs-tools.ts`（`GODOT_DOCS_TOOLS`，默认关） |
| 文档缓存 | `godot-docs-cache.ts` / `godot-docs-search.ts` → `~/.pi/agent/x-agent/godot-docs/` |
| Addon 安装 | `electron/agent/godot-addon-install.ts` |
| Addon | `packages/godot-editor-rpc` |

要点：默认端口 `8765`（回退 `8765–8774`），endpoint 写入 `x-agent-godot-rpc.json`；`run_current_scene` / `play_main_scene` 短时收集报错；`import_resources` 扫描或按路径 reimport。设置入口：**设置 → Godot → 编辑器连接 / 官方文档**。详见 [`packages/godot-editor-rpc/README.md`](packages/godot-editor-rpc/README.md)。

### 用量与上下文面板

- `context-breakdown.ts`：右栏组成拆解（含协议损耗）
- `usage-store.ts` → `~/.pi/agent/x-agent-usage.json`
- UI：右栏「上下文」；设置 → 用量

### 认证与自动更新

- `auth-check.ts` / `pi-cli.ts`（含 `openPiLogin`）
- `auto-updater.ts` / `update-feed.ts`：仅打包版启用 `electron-updater`，`provider: "github"` → `Fromlan/X-agent` Releases；启动后静默检查，设置可「打开 Releases」回退
- UI：设置 → 通用 → 检查 / 下载 / 安装更新；顶栏角标；`loadPrefsWithRecovery` 损坏偏好备份提示
- 安全说明见 README「安全与隐私」；工具页「只读安全档」关闭 bash/write/edit

### 持久化与隔离

| 路径 | 用途 |
|---|---|
| `~/.pi/agent/x-agent.json` | 客户端偏好 |
| `~/.pi/agent/x-agent-providers.json` | 供应商档案 |
| `~/.pi/agent/x-agent-godot-rpc.json` | Godot RPC endpoint |
| `~/.pi/agent/x-agent-packages.json` | Packages 安装记录 |
| `~/.pi/agent/x-agent-usage.json` | 用量汇总 |
| `~/.pi/agent/x-agent/sessions/` | 本应用会话 |
| `~/.pi/agent/x-agent/checkpoints/` | Shadow Git 工作区检查点（按项目隔离） |
| `~/.pi/agent/x-agent/godot-docs/` | Godot 文档缓存 |
| `auth.json` / `models.json` | Pi 认证与模型 |

会话列表只读 X-agent 会话目录；恢复须拒绝目录外路径。

### 构建

`electron.vite.config.ts`：main `electron/main.ts`、preload `electron/preload.ts`、renderer `index.html`。  
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
