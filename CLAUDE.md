# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

X-agent 是基于 Pi SDK 的 Electron 桌面 Agent 客户端。当前仓库只有一个实际应用 `apps/desktop`；根 `package.json` 不是 npm workspace，仅提供转发到该应用的便捷脚本。

当前能力：通用 Pi Agent GUI、会话管理、插件管理页、供应商订阅（cc-switch 风格档案 + 拉取 `/models`）、工具白名单、Godot RPC 编辑器控制面（重载/运行场景 + Agent 工具）。Godot Pi 包深化与多 Agent Fleet UI 仍属后续规划。

运行环境要求：Node.js 22+。Windows 上 Pi 的 `bash` 工具需要 Git for Windows，或在 `~/.pi/agent/settings.json` 中配置 `shellPath`。模型与认证复用 `~/.pi/agent/auth.json` 和 `models.json`；本应用可通过「设置 → 供应商」写入这两份文件。

## 常用命令

依赖锁文件位于 `apps/desktop/package-lock.json`，因此安装命令应在该目录执行：

```bash
cd apps/desktop
npm install
```

也可在仓库根目录运行：

```bash
npm run desktop:dev        # Electron 开发模式
npm run desktop:build      # 构建 main、preload、renderer
npm run desktop:typecheck  # Node + Web 类型检查
npm run desktop:test       # 离线断言脚本套件
npm run desktop:smoke      # 真实模型请求冒烟
npm run desktop:dist       # electron-builder 打包（需先 build）
```

应用目录等价命令：`npm run typecheck` / `npm test` / `npm run preview`（`--prefix apps/desktop`）。

`npm test` 串联：`test-history-mapper`、`test-session-paths`、`test-chat-store`、`test-fleet-registry`、`test-plugin-host`、`test-provider-store`、`test-model-fetch`、`test-godot-rpc-bridge`。

冒烟脚本可传入工作目录：

```bash
npm exec --prefix apps/desktop -- tsx scripts/smoke-session.ts "D:\path\to\project"
```

该冒烟会读取本机 Pi 认证并调用真实模型，不是离线单元测试。

## 架构

应用遵循 Electron 的三进程边界：

- `electron/main.ts` 创建窗口并注册所有 IPC handler。主进程持有唯一 `SessionHost`，所有 Pi SDK、文件系统、会话、模型、供应商与插件操作都留在此侧。
- `electron/preload.ts` 通过 `contextBridge` 暴露窄接口 `window.xAgent`。Renderer 启用了 `contextIsolation`，且关闭 `nodeIntegration`；新增跨进程能力时应同步修改 IPC 类型、主进程 handler 和 preload API。
- `src/` 是 React renderer。`App.tsx` 负责初始化偏好、模型和会话，订阅主进程推送事件，并组合顶栏、会话侧栏、聊天区、插件页与设置弹窗。Renderer 不直接依赖 Pi SDK。
- `shared/ipc.ts` 是主进程、preload、renderer 共同的协议源。

### Agent 与事件数据流

`electron/agent/session-host.ts` 是核心编排层：

1. `ModelRuntime` 从 `~/.pi/agent/auth.json` 和 `models.json` 初始化可用模型。
2. `DefaultResourceLoader` 以用户选定的项目目录为 `cwd`，加载 Pi 的 skills、extensions 等资源。
3. `createAgentSession` 创建或恢复 `AgentSession`，工具白名单、模型和 thinking level 来自客户端偏好。
4. Pi 的消息增量和工具执行事件被转换为 `UiAgentEvent`，经 `agent:event` IPC 推送到 renderer。
5. `src/stores/chat-store.ts` 将流式事件归并为 assistant/tool 聊天项；恢复旧会话时，`electron/agent/history.ts` 将 Pi 的完整消息历史转换成同一种 `HistoryItem` 结构。

当会话正在流式输出时，再次发送 prompt 使用 Pi 的 `streamingBehavior: "steer"`，而不是并行创建另一轮请求。切换项目、新建会话或恢复会话前，`SessionHost` 会释放当前 session。

### 供应商订阅

- `electron/agent/provider-store.ts`：档案 CRUD，持久化到 `~/.pi/agent/x-agent-providers.json`。
- 启用档案时写入 Pi `auth.json`（api_key）与 `models.json.providers[id]`，再经 `SessionHost.applyActivatedProvider` / `reloadRuntime` 刷新模型列表。
- `electron/agent/model-fetch.ts`：按 cc-switch 风格探测候选 URL（如 `/v1/models`、剥离 `/anthropic` 等后缀），主进程代发 HTTP，经 IPC `fetchProviderModels` 返回。
- UI：`SettingsPanel` 供应商页用表格编辑模型；支持「拉取模型」勾选后合并/替换。

### 插件管理

- `electron/agent/plugin-host.ts`：枚举 / 读写全局与项目侧 Prompt Templates、Skills、Extensions。
- UI：独立「插件」页（`PluginsPage`），与聊天视图切换；不要把插件逻辑塞进 renderer 直连磁盘。

### Godot 编辑器 RPC

本地 TCP JSON-lines 桥：桌面为主机，Godot 插件为客户端。

| 组件 | 路径 |
|---|---|
| 协议 / 超时常量 | `apps/desktop/shared/godot-rpc.ts` |
| 桥接服务 | `electron/agent/godot-rpc-bridge.ts` |
| Agent 工具 | `electron/agent/godot-tools.ts`（经 `SessionHost` `customTools`；白名单 `GODOT_TOOLS`，默认关） |
| 插件安装 | `electron/agent/godot-addon-install.ts` → 拷贝 `packages/godot-editor-rpc/addons/x_agent_rpc` |
| Godot 插件 | `packages/godot-editor-rpc`（`plugin.gd` + `rpc_debugger.gd`） |

要点：

- 端口默认 `8765`，占用时回退 `8765–8774`，并写入 `~/.pi/agent/x-agent-godot-rpc.json`。
- `run_current_scene` / `godot_run_scene` 会短时收集 Output + 调试器 Errors 页签报错后回传。
- UI：设置 → Godot RPC；详细说明见 [`packages/godot-editor-rpc/README.md`](packages/godot-editor-rpc/README.md)。

### 持久化与隔离

| 文件 / 目录 | 用途 |
|---|---|
| `~/.pi/agent/x-agent.json` | 客户端偏好 |
| `~/.pi/agent/x-agent-providers.json` | 供应商档案 |
| `~/.pi/agent/x-agent-godot-rpc.json` | Godot RPC 当前 endpoint（host/port） |
| `~/.pi/agent/x-agent/sessions/` | 本应用会话 |
| `~/.pi/agent/auth.json` / `models.json` | Pi 认证与模型（启用订阅时写入） |

会话列表只读取 X-agent 专用会话目录，恢复操作拒绝目录外路径；修改会话逻辑时必须保持这一隔离约束。

### 构建配置

`electron.vite.config.ts` 分别构建：

- main 入口：`electron/main.ts`
- preload 入口：`electron/preload.ts`
- renderer 入口：`index.html`

`tsconfig.node.json` 检查 Electron、shared 和构建配置；`tsconfig.web.json` 检查 React 与 shared。Renderer 支持 `@/` 和 `@shared/` 别名，Node 侧仅配置 `@shared/`。

## UI 约束

视觉规范集中在 `DESIGN.md`，修改界面前应以该文件为准。关键约束是：

- 深色为默认主题，浅色通过 `body[data-theme="light"]` 覆盖。
- 颜色、圆角和阴影必须使用 CSS token；颜色使用 OKLCH，组件与 JavaScript 中不要硬编码色值。
- 使用 Inter 与 Geist Mono，保持约 13px 的紧凑开发工具密度、0.5px 半透明边框和克制阴影。
- 图标使用矢量图标（当前为 `lucide-react`），不要用 emoji 充当 UI 图标。
- hover、focus、active 优先从现有 token 派生相对色；focus 使用 accent `box-shadow`，不使用默认 outline。
- 动效需尊重 `prefers-reduced-motion`。
- 设置弹窗为宽面板 + 左侧分页；内容区需可滚动，底部操作栏避免被裁切（`min-height: 0` + `overflow-y: auto`）。
