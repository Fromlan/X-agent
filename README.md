# X-agent

基于 [Pi](https://pi.dev) SDK 的桌面 Agent 客户端。当前提供通用 Pi Agent GUI；Godot 编辑器 RPC 控制面（重载/运行场景等）已可用；多 Agent Fleet 仍在扩展中。

## 前置条件

- Node.js 20+
- 模型认证二选一：
  - 已有 Pi CLI：`npm i -g @earendil-works/pi-coding-agent` 后运行 `pi`，执行 `/login` 或配置 API Key
  - 或在本应用 **设置 → 供应商** 中新建订阅档案并「保存并启用」（会写入 `~/.pi/agent/auth.json` 与 `models.json`）
- Windows：建议安装 [Git for Windows](https://git-scm.com/download/win)（Pi 的 `bash` 工具需要 bash）
  - 或在应用横幅中一键写入 `shellPath`，或手动编辑 `~/.pi/agent/settings.json`

## 开发运行

```bash
cd apps/desktop
npm install
# 若 Electron 二进制下载失败（国内网络），可先设置镜像：
#   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run dev
```

也可在仓库根目录：

```bash
npm run desktop:dev
```

## 使用

1. 点击「打开项目」选择工作目录（默认 `continueRecent` 续上该项目最近会话）
2. 在顶部选择模型 / Thinking 级别
3. 在输入框发送指令；运行中可继续发送（steer）或点「中止」
4. 左侧可恢复 / 重命名 / 删除历史会话
5. 顶栏「插件」管理 Prompt Templates / Skills / Extensions（全局 `~/.pi/agent` 与项目 `.pi`）
6. 顶栏「设置」分页：
   - **通用**：主题与偏好摘要
   - **供应商**：多份 API 订阅档案（参考 [cc-switch](https://github.com/farion1231/cc-switch)）；支持预设、启用、表格编辑模型；可从供应商 `/models` 端点拉取模型列表后合并或替换
   - **工具**：工具白名单（即时应用到当前会话）
   - **Godot RPC**：选择引擎、安装/更新 `x_agent_rpc` 插件、启停桥接、ping，以及 open/reload/run（含错误收集）/stop 测试
7. 使用 Godot 控制面时：在 **设置 → 工具** 勾选 Godot 工具；项目需启用 **X-agent RPC** 插件并保持桥接已连接

### 数据目录

| 路径 | 用途 |
|---|---|
| `~/.pi/agent/x-agent.json` | 客户端偏好（主题、最后项目、模型、thinking、工具、Godot 引擎路径） |
| `~/.pi/agent/x-agent-providers.json` | 供应商订阅档案（本应用维护，不替代 Pi CLI） |
| `~/.pi/agent/x-agent-godot-rpc.json` | Godot RPC 当前监听 endpoint（host/port） |
| `~/.pi/agent/x-agent/sessions/` | 本应用会话（与 Pi CLI 隔离） |
| `~/.pi/agent/auth.json` / `models.json` | Pi 认证与模型注册表（启用订阅时写入） |
| `~/.pi/agent/settings.json` | Pi 设置（如 `shellPath`） |
| `~/.pi/agent/` 与项目 `.pi/` | skills / extensions / prompts（与 Pi CLI 一致） |

**会话隔离**：本客户端只读写 `~/.pi/agent/x-agent/sessions/`，不读写 Pi CLI 默认的 `~/.pi/agent/sessions/`。

## 质量门禁

```bash
npm run desktop:typecheck
npm run desktop:test
npm run desktop:build
# Windows 安装包 / portable（需先 build）：
npm run desktop:dist
```

冒烟（真实模型调用，需本机已配置认证）：

```bash
npm run desktop:smoke
# 或指定工作目录：
npm exec --prefix apps/desktop -- tsx scripts/smoke-session.ts "D:\path\to\project"
```

CI：`.github/workflows/ci.yml`（typecheck + test + build）。

## 架构简述

- **Electron 主进程**：`SessionHost`、供应商档案（`provider-store`）、模型拉取（`model-fetch`）、插件管理（`plugin-host`）、Godot RPC bridge / tools / addon install、Fleet registry
- **Preload**：`contextBridge` 暴露 `window.xAgent`
- **Renderer**：React UI（会话侧栏 / 对话 / 顶栏控制 / 插件页 / 设置弹窗）
- **协议**：`apps/desktop/shared/ipc.ts`（跨进程）+ `apps/desktop/shared/godot-rpc.ts`（Godot TCP RPC）

启用供应商档案时：主进程写入 Pi `auth.json` + `models.json`，再 `reloadRuntime` 刷新可选模型列表。

## 仓库包

| 路径 | 说明 |
|---|---|
| [`apps/desktop`](apps/desktop) | Electron 桌面客户端 |
| [`packages/godot-pi`](packages/godot-pi) | Godot Pi Package（skills / prompts / extension） |
| [`packages/godot-editor-rpc`](packages/godot-editor-rpc) | Godot 4 编辑器 RPC 插件（含运行场景错误回传） |
| [`packages/fleet`](packages/fleet) | 多 Agent Fleet 说明（registry 已在 desktop 主进程） |

安装 Godot Pi 包：

```bash
pi install D:/UGit/X-agent/packages/godot-pi
```

开发者与 UI 约定见 [`CLAUDE.md`](CLAUDE.md)、[`DESIGN.md`](DESIGN.md)；Pi 插件类型说明见 [`Pi插件指导文档.md`](Pi插件指导文档.md)。

## 后续规划

- Fleet：多 `SessionHost` 并行与 UI 编排
- Godot RPC：`play_main_scene`、资源导入、多编辑器客户端路由
- 应用内 Pi 登录与自动更新
