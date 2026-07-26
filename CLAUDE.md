# CLAUDE.md

给在本仓库工作的编码助手（含 Claude Code）的项目指引。

## 项目概览

X-agent 是基于 Pi SDK 的 Electron 桌面 Agent。仓库只有一个实际应用 [`apps/desktop`](apps/desktop)；根 `package.json` 不是 npm workspace，仅转发脚本。

**当前能力**：Agent GUI 与会话隔离、供应商订阅、设置内插件管理（Prompt / Skill / Extension / Theme / Packages）、工具白名单、Godot RPC（含主场景运行 / 资源导入 / 多客户端路由）、应用内 Pi 登录引导与打包版自动更新。

运行环境：Node.js 22+。Windows 上 Pi `bash` 需要 Git for Windows，或配置 `~/.pi/agent/settings.json` 的 `shellPath`。认证与模型复用 `~/.pi/agent/auth.json`、`models.json`（可通过设置 → 供应商写入）。

## 常用命令

锁文件在 `apps/desktop/package-lock.json`，安装在该目录执行：

```bash
cd apps/desktop
npm install
```

根目录便捷脚本：

```bash
npm run desktop:dev        # Electron 开发
npm run desktop:build
npm run desktop:typecheck
npm run desktop:test       # 离线断言脚本
npm run desktop:smoke      # 真实模型冒烟
npm run desktop:dist       # electron-builder（Windows）
```

`npm test`（在 `apps/desktop`）串联：`test-history-mapper`、`test-session-paths`、`test-session-title`、`test-chat-store`、`test-plugin-host`、`test-provider-store`、`test-model-fetch`、`test-godot-rpc-bridge`、`test-pi-cli`。

冒烟（需本机认证）：

```bash
npm exec --prefix apps/desktop -- tsx scripts/smoke-session.ts "D:\path\to\project"
```

## 架构

Electron 三进程边界：

- `electron/main.ts`：注册 IPC；持有 `SessionHost`、`GodotRpcBridge`、`AppAutoUpdater`。Pi SDK / 文件系统 / 会话 / 模型 / 供应商 / 插件均在主进程。
- `electron/preload.ts`：`contextBridge` 暴露 `window.xAgent`。`contextIsolation` 开、`nodeIntegration` 关；新增能力需同步改 `shared/ipc.ts`、main handler、preload。
- `src/`：React renderer。`App.tsx` 组合顶栏、侧栏、聊天、设置弹窗（含插件分页）。不直接依赖 Pi SDK。
- `shared/ipc.ts`：跨进程协议源；`shared/godot-rpc.ts`：Godot TCP 协议。

### Agent 与事件

[`session-host.ts`](apps/desktop/electron/agent/session-host.ts) 编排单会话：

1. `ModelRuntime` 从 auth / models 初始化模型。
2. `DefaultResourceLoader` 以项目 `cwd` 加载 skills / extensions 等。
3. `createAgentSession` 创建或恢复会话；工具白名单、模型、thinking 来自偏好。
4. Pi 事件转为 `UiAgentEvent`，经 `agent:event` 推到 renderer。
5. Renderer 用 [`chat-store.ts`](apps/desktop/src/stores/chat-store.ts) `applyAgentEvent` 归并；恢复时 `history.ts` 映射为同一 `HistoryItem` 结构。
6. `session_info` / status / prefs（如 `lastSessionPath`）写入顶栏与偏好。

流式中再次 prompt 使用 `streamingBehavior: "steer"`。切换项目 / 新会话 / 恢复前释放当前 session。会话自动标题：[`session-title.ts`](apps/desktop/electron/agent/session-title.ts)。

上下文组装细节（Pi system 分层、白名单、Godot、隔离边界）：见 [`AGENT_CONTEXT.md`](AGENT_CONTEXT.md)。

### 供应商

- `provider-store.ts` → `~/.pi/agent/x-agent-providers.json`；启用时写 Pi auth / models
- `model-fetch.ts`：探测 `/v1/models` 等；IPC `fetchProviderModels`
- UI：设置 → 供应商

### 插件与 Packages

- `plugin-host.ts`：Prompt / Skill / Extension / **Theme**（全局与项目 `.pi`）
- `package-manager.ts`：`pi install` 封装 + `x-agent-packages.json` 记录；一键安装 `godot-pi`
- UI：设置 → 插件（[`PluginsPage.tsx`](apps/desktop/src/components/PluginsPage.tsx) 嵌入设置）

### Godot RPC

| 组件 | 路径 |
|---|---|
| 协议 | `apps/desktop/shared/godot-rpc.ts` |
| 桥接 | `electron/agent/godot-rpc-bridge.ts`（多客户端 id / 活动选路） |
| 工具 | `electron/agent/godot-tools.ts`（白名单 `GODOT_TOOLS`，默认关） |
| 安装 | `electron/agent/godot-addon-install.ts` |
| Addon | `packages/godot-editor-rpc` |

要点：默认端口 `8765`（回退 `8765–8774`），endpoint 写入 `x-agent-godot-rpc.json`；`run_current_scene` / `play_main_scene` 短时收集报错；`import_resources` 扫描或按路径 reimport。详见 [`packages/godot-editor-rpc/README.md`](packages/godot-editor-rpc/README.md)。

### 认证与自动更新

- `auth-check.ts` / `pi-cli.ts`（含 `openPiLogin`）
- `auto-updater.ts`：仅打包版启用 `electron-updater`（GitHub Releases）
- UI：设置 → 通用

### 持久化与隔离

| 路径 | 用途 |
|---|---|
| `~/.pi/agent/x-agent.json` | 客户端偏好 |
| `~/.pi/agent/x-agent-providers.json` | 供应商档案 |
| `~/.pi/agent/x-agent-godot-rpc.json` | Godot RPC endpoint |
| `~/.pi/agent/x-agent-packages.json` | Packages 安装记录 |
| `~/.pi/agent/x-agent/sessions/` | 本应用会话 |
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
