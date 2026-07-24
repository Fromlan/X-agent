# X-agent

基于 [Pi](https://pi.dev) SDK 的 Electron 桌面 Agent 客户端。面向通用编程助手，并对 Godot 编辑器提供 RPC 控制面；支持多工作区 Fleet、**并行实现+审阅** 与分槽独立对话。

## 功能一览

| 能力 | 说明 |
|---|---|
| Agent 聊天 | 打开项目、续会话、steer / 中止、Thinking 级别 |
| 会话 | 列表 / 恢复 / 重命名 / 删除（与 Pi CLI 会话目录隔离） |
| 供应商 | 多档案订阅、预设、拉取 `/models`、导入 Pi / cc-switch |
| 插件 | **设置 → 插件**：提示词 / 技能 / 扩展 / 主题 / Packages |
| 工具白名单 | 内置工具 + 可选 Godot 工具 |
| Godot RPC | 开/重载场景、运行当前/主场景、资源导入、多编辑器选路、错误回传 |
| Fleet | 多 `SessionHost`；顶栏切换；分槽独立聊天；worker/reviewer **并行实现+审阅**（双波次 + 双栏） |
| 认证与更新 | 设置 → 通用：打开 Pi 登录、检查 / 下载 / 安装更新（打包版） |

## 前置条件

- Node.js 22+（CI / Release 与 Electron 运行时一致；`node:sqlite` 用于 cc-switch 导入）
- 模型认证二选一：
  - Pi CLI：`npm i -g @earendil-works/pi-coding-agent` 后 `pi` → `/login` 或配置 API Key
  - 或本应用 **设置 → 供应商** 新建档案并「保存并启用」（写入 `~/.pi/agent/auth.json` 与 `models.json`）
  - 也可在 **设置 → 通用** 使用「打开 Pi 登录」
- Windows：建议安装 [Git for Windows](https://git-scm.com/download/win)（Pi `bash` 工具需要 bash），或在横幅 / `~/.pi/agent/settings.json` 配置 `shellPath`

## 开发运行

```bash
cd apps/desktop
npm install
# 若 Electron 二进制下载失败（国内网络）：
#   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run dev
```

仓库根目录也可：`npm run desktop:dev`。

## 使用

1. 「打开项目」选择工作目录（默认续上该项目最近会话）
2. 顶栏选择模型 / Thinking；输入框发送指令（运行中可 steer 或「中止」）
3. 左侧管理历史会话；顶栏下方 **Fleet** 条可添加「工作区 / 审阅」、切换或移除槽位
4. **并行实现+审阅**：主会话已打开项目后，在输入框写任务 → 点「并行实现+审阅」  
   - Wave1：实现槽改代码、审阅槽列风险（并行）  
   - Wave2：实现结束后，审阅槽基于 `git diff`（或会话摘录）做具体审查  
   - 启动后切到实现槽，聊天区左右双栏分别显示实现 / 审阅对话；点栏或芯片切换输入目标  
   - 详见 [`packages/fleet/README.md`](packages/fleet/README.md)
5. **设置**分页：
   - **通用**：主题摘要、认证引导、自动更新
   - **供应商**：订阅档案、预设、拉模型、导入已有
   - **工具**：工具白名单（即时应用到当前会话）
   - **插件**：Prompt / Skill / Extension / Theme / Packages（含一键安装 Godot Pi 包）
   - **Godot RPC**：引擎路径、安装 addon、启停桥接、客户端选路、场景/导入/运行测试
6. 使用 Godot 控制面时：在 **设置 → 工具** 勾选 Godot 工具；项目启用 **X-agent RPC** 并保持桥接已连接

### 数据目录

| 路径 | 用途 |
|---|---|
| `~/.pi/agent/x-agent.json` | 客户端偏好（主题、项目、模型、thinking、工具、Godot 引擎路径） |
| `~/.pi/agent/x-agent-providers.json` | 供应商订阅档案 |
| `~/.pi/agent/x-agent-godot-rpc.json` | Godot RPC 当前 endpoint（host/port） |
| `~/.pi/agent/x-agent-packages.json` | 本应用记录的 Packages 安装源 |
| `~/.pi/agent/x-agent/sessions/` | 本应用会话（与 Pi CLI 隔离） |
| `~/.pi/agent/auth.json` / `models.json` | Pi 认证与模型注册表 |
| `~/.pi/agent/settings.json` | Pi 设置（如 `shellPath`） |
| `~/.pi/agent/` 与项目 `.pi/` | prompts / skills / extensions / themes |

**会话隔离**：只读写 `~/.pi/agent/x-agent/sessions/`，不读写 Pi CLI 的 `~/.pi/agent/sessions/`。

## 质量门禁

```bash
npm run desktop:typecheck
npm run desktop:test
npm run desktop:build
npm run desktop:dist   # Windows NSIS / portable（需先 build）
```

冒烟（真实模型，需本机认证）：

```bash
npm run desktop:smoke
# 或：
npm exec --prefix apps/desktop -- tsx scripts/smoke-session.ts "D:\path\to\project"
```

CI：`.github/workflows/ci.yml`（typecheck + test + build）。

## 发布与自动更新

推送 `v*` tag 后，[`.github/workflows/release.yml`](.github/workflows/release.yml) 在 Windows 上构建安装包并创建 GitHub Release（含 `latest.yml`，供 `electron-updater` 使用）。**Release 正文取自 [`CHANGELOG.md`](CHANGELOG.md) 对应版本章节**；若缺少该章节或内容为空，发版会失败。

### 升版流程

1. **整理更新说明**：编辑 `CHANGELOG.md`，把 `## Unreleased` 下本版本内容挪到新建章节（如 `## 0.1.3`），按「功能 / 修复 / 文档」等写面向用户的条目。
2. **准备版本号**（同步 `apps/desktop/package.json` + lock，并校验 CHANGELOG）：

```bash
node scripts/prepare-release.mjs 0.1.3
```

3. **提交并打 tag 推送**：

```bash
git add CHANGELOG.md apps/desktop/package.json apps/desktop/package-lock.json
git commit -m "release: v0.1.3"
git tag v0.1.3
git push origin HEAD && git push origin v0.1.3
```

也可在 Actions → Release → Run workflow 手动填版本触发（同样要求 CHANGELOG 已有对应章节）。本地预览 Release 正文：

```bash
node scripts/extract-changelog.mjs 0.1.3
```

安装版在 **设置 → 通用** 可检查更新。

## 架构简述

```
Renderer (React) ──window.xAgent──► Preload ──IPC──► Main
                                                      ├─ FleetHostManager → SessionHost(s) + FleetOrchestrator
                                                      ├─ provider-store / model-fetch
                                                      ├─ plugin-host / package-manager
                                                      ├─ GodotRpcBridge ← TCP → Godot addon
                                                      └─ AppAutoUpdater (packaged)
```

- 协议源：[`apps/desktop/shared/ipc.ts`](apps/desktop/shared/ipc.ts)、[`apps/desktop/shared/godot-rpc.ts`](apps/desktop/shared/godot-rpc.ts)
- 开发约定：[`CLAUDE.md`](CLAUDE.md)；UI：[`DESIGN.md`](DESIGN.md)；Pi 插件类型：[`Pi插件指导文档.md`](Pi插件指导文档.md)
- 变更记录：[`CHANGELOG.md`](CHANGELOG.md)

## 仓库包

| 路径 | 说明 |
|---|---|
| [`apps/desktop`](apps/desktop) | Electron 桌面客户端 |
| [`packages/godot-editor-rpc`](packages/godot-editor-rpc) | Godot 4 编辑器 RPC 插件 |
| [`packages/godot-pi`](packages/godot-pi) | Godot Pi Package（skills / prompts / extension） |
| [`packages/fleet`](packages/fleet) | Fleet 多 Agent 说明（实现位于 desktop） |

Godot Pi 包安装：

- 推荐：设置 → 插件 → Packages →「一键安装 Godot Pi 包」
- 或：`pi install <仓库>/packages/godot-pi`

## 后续规划

- Fleet：审阅意见回流 worker（第三波）、多 pair / 自定义角色图
- Godot：更多编辑器能力（如调试控制）与 `godot-pi` 持续扩充
