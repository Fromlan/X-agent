# X-agent

[中文](README.md) · [English](README.en.md)

[![Version](https://img.shields.io/badge/version-0.5.5-blue)](apps/desktop/package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-blueviolet)](#环境要求)
[![Godot: 4.x](https://img.shields.io/badge/Godot-4.x-478cbf)](#环境要求)

**Godot 4 项目的桌面编码 Agent**——改场景、改脚本、跑场景、回滚，**在同一会话里完成**。

不是聊天工具的 UI 壳；不是 VS Code 替代品；是**长任务型 Agent**：回滚靠 Shadow Git、模式硬闸、Thinking 档位、品牌化客户端。

![X-agent 主界面](docs/screenshots/main-window.png)

## 目录

- [30 秒上手](#30-秒上手)
- [你要用 X-agent 做什么？](#你要用-x-agent-做什么)
- [关键能力](#关键能力)
- [我该不该用 X-agent？](#我该不该用-x-agent)
- [三个必知概念](#三个必知概念)
- [键盘快捷键](#键盘快捷键)
- [设置](#设置)
- [数据位置](#数据位置)
- [更新 & 安装](#更新--安装)
- [安全与隐私](#安全与隐私)
- [常见问题](#常见问题)
- [反馈与贡献](#反馈与贡献)
- [致谢](#致谢)
- [联系](#联系)

## 30 秒上手

1. **下载**：[Releases](https://github.com/Fromlan/X-agent/releases/latest) 装 Windows 安装包
2. **打开项目**：选 Godot 工程目录（自动续最近会话）
3. **登录认证**：设置 → 通用 → 打开 Pi 登录（或本机 `pi login` 已登录）
4. **（可选）Godot 编辑器连接**：设置 → Godot → 编辑器连接 → 安装 **X-agent RPC** 插件
5. 输 prompt，按回车

**深入**：下方按 4 类角色场景展开。

## 你要用 X-agent 做什么？

### 🎮 Godot 开发者 · 改代码 + 跑场景
打开项目 → Agent 模式 → 选模型 → 问"在 `Player.gd` 加冲刺功能，跑一下当前场景" → Agent 改文件、编辑器 RPC 重载、跑场景、报错回传，**都在同一会话**。

### ✍️ 独立策划 · 写设计文档（不污染 game/）
新会话选 **design 类型** → 写只允许落到 `<cwd>/game-design/` → 预装 5 个内置 design skill 帮你做立项 / 数值 / 核心循环 → UI 切暖色主题与代码会话区分。

### 🔬 研究只读 · 问 API、查文档
切 **调研 (Ask) 模式** → 工具集硬闸关 `write` / `edit` → `bash` 仅放行只读命令且路径须在项目 cwd 内 → 适合"先摸清 GDScript 单例怎么写再动手"。

### 🎯 目标驱动 · 让 Agent 自己跑到完成
切 **目标 (Goal) 模式** → 写完成条件（如"在 `ScoreManager.gd` 加 combo 计数 + HUD 显示"） → 评估未达自动续轮（轮次 + token 双预算）。

## 关键能力

| | |
|---|---|
| **🎯 策划会话 (design)** | 写操作硬约束到 `<cwd>/game-design/`，UI 暖色主题。预装 5 个内置 skill：`design-initiation` / `design-process` / `design-systems` / `design-numerical` / `design-core-loop` |
| **🎮 Godot 集成** | 编辑器 RPC（端口 8765，8765–8774 回退）；17 个工具覆盖场景内省 / 调试器 / 资源治理 / 导出 / 配置读写 / 只读内省 |
| **📜 godot-docs-4-7** | 引擎惯例技能（Pi 自动发现）；按需 `read` SKILL.md，**0 token 浪费在"用不上的方法论"上** |
| **↩️ Shadow Git 撤回** | 每轮检查点独立于你的 `.git`，按 diff 路径还原（**不会吞掉回合期间你的手动编辑**） |
| **🔀 4 模式 + 2 类型** | 互斥切换：Agent / 调研(Ask) / Plan / 目标(Goal)；`code` / `design` 类型（与模式正交） |
| **⚡ Diff 显示** | 撤回前看 `+/-` 着色 diff（带文件数 / `+N` / `-N` 统计），确认无误再点撤回 |
| **🎨 8 套品牌 logo + 自定义** | 设置 → 通用 → 品牌：霓虹赛博 / 熔岩灼烧 / 电浆雷霆 / 全息彩虹 / 玫瑰金金属 / 像素 8-bit / 故障 Glitch / 宇宙星云 |
| **🧠 思考档位 + thinking-orbs** | DeepSeek 等模型自动钳制 Thinking；运行中粒子轨道而非转圈 |
| **🎨 v1.1 设计语言** | elevation 驱动：Composer 是整窗唯一主元素，三栏壳层（TopBar / Sidebar / RightPanel）降为低调 chrome；10 主题族（default / nord / tokyo / paper / contrast × dark/light） |

## 我该不该用 X-agent？

| 你的情况 | 建议 |
|---|---|
| 做 Godot 4 项目，**Windows** | ✅ 直接装 |
| 做 Godot 4 项目，**macOS / Linux** | ⏸ 等 macOS / Linux 安装包（[ROADMAP 3.4](docs/roadmap.md)） |
| 用 Unity / Unreal / 通用编码 | ❌ 不合适（Godot 专精） |
| 只想试 LLM 聊天 | ❌ 直接用 [Pi CLI](https://pi.dev) 更轻 |
| 想要云端多人协作 | ❌ 本机桌面型，单人项目 |

## 三个必知概念

- **会话模式**（互斥）：Agent / 调研(Ask) / Plan / 目标(Goal)，决定**能用什么工具**
- **会话类型**（独立）：`code`（默认）/ `design`，写操作的**作用域**
- **撤回源**：Shadow Git 检查点（独立于你的 `.git`），按 diff 路径还原

## 键盘快捷键

| 快捷键 | 作用 |
|---|---|
| `Shift+Tab` | 循环切换模式 |
| `F12` / `Ctrl+Shift+I` | DevTools（需 `--x-agent-debug` / `X_AGENT_DEBUG=1`） |
| `Esc` | 关闭当前弹窗 |
| `Ctrl+,` | 打开设置 |
| `Ctrl+Enter` | 多行输入时发送消息 |

## 设置

| 分页 | 内容 |
|---|---|
| 通用 | 主题、Thinking 默认、bash 路径、Pi 登录、自动更新、**品牌（logo 选择）** |
| 供应商 | 模型档案、导入 Pi / cc-switch 配置、Thinking 钳制 |
| 用量 | 本地按日 / 按模型汇总 |
| 工具 | 内置 / Godot 编辑器 / Godot 文档 工具白名单；Agent / Goal 模式生效 |
| 插件 | Prompt / Skill / Extension / Theme / Packages（Pi 五类） |
| Godot | **编辑器连接**（RPC 桥 + 插件安装/更新） |

完整配置项：[`docs/agent.md` §四](docs/agent.md) / [`docs/context.md`](docs/context.md)

## 数据位置

应用数据在 `~/.pi/agent/` 下；与 Pi CLI **共用** `auth.json` / `models.json`，其余**隔离**：

| 路径 | 用途 |
|---|---|
| `x-agent.json` | 客户端偏好（含 theme / Thinking 默认 / sidebar 宽度等） |
| `x-agent/sessions/` | 本应用会话（与 Pi CLI 分开） |
| `x-agent/checkpoints/` | Shadow Git 检查点（按项目隔离，**不写你的 .git**） |
| `x-agent/plans/` / `x-agent/goals/` | Plan 文件 / Goal 日记 |
| `x-agent-logos/` | 自定义品牌 logo（UUID 文件名，**应用外勿编辑**） |
| `x-agent-{providers,packages,usage,godot-rpc}.json` | 档案 / 安装记录 / 用量 / RPC endpoint |

完整清单：[`CLAUDE.md` §持久化与隔离](CLAUDE.md)

## 更新 & 安装

- **自动更新**：安装版启动后静默检查 [GitHub Releases](https://github.com/Fromlan/X-agent/releases)（不自动下载）。有新版本时应用内提示「立即更新 / 稍后」。
- **代码签名**：可选 `CSC_LINK` + `CSC_KEY_PASSWORD`（缓解 SmartScreen 拦截）。未配置仍可装。

## 安全与隐私

编码 Agent 默认具备较强本机能力，请按需收紧。

### API Key
- `x-agent-providers.json` 默认用 Electron `safeStorage` 加密；激活时明文写入 Pi `auth.json`（与 Pi CLI 共用）
- 解密失败（换机器 / keyring 重置）时**保留盘上密文** `encryptedKey`，不覆盖——避免密钥永久丢失
- ⚠️ 不要把 `~/.pi/agent/` 同步到不可信位置

### 工具
- 默认开 `bash` / `write` / `edit`（**Agent / Goal 模式**）
- **调研 / Plan 模式**硬闸关 `write` / `edit`；`bash` 仅放行只读命令且路径须在项目 cwd 内
- `read` / `grep` / `find` / `ls` 路径参数强制 cwd 内
- Godot 工具开关在 IPC 层校验（被攻陷 UI 也无法绕过默认关闭项）

### 网络 / 进程
- Godot RPC 仅监听 `127.0.0.1`，endpoint 含共享 token（握手失败 → 更新并重启 X-agent RPC 插件）
- Provider baseUrl 拒绝私网 / `*.nip.io` / `localtest.me`（防 SSRF）
- `pi install` 跳过 npm lifecycle scripts

## 常见问题

**Q: 在线 / 离线能用吗？**
A: 模型调用走 API（在线）；本地用量 / 检查点 / 会话 / 撤回全部离线。Godot 文档技能 `godot-docs-4-7` 在 Godot 项目内自动索引。

**Q: 为什么不用 VS Code + Copilot？**
A: 1) Godot 编辑器 RPC 联动（场景内省 / 调试器 / 资源治理）VS Code 插件做不到；2) Shadow Git 撤回独立于你的 `.git`（VS Code 不会按 diff 路径还原）；3) 4 模式 + 2 类型硬闸（VS Code 插件是建议，X-agent 是 IPC 层强制）。

**Q: 可以用在非 Godot 项目吗？**
A: 可以（IDE 本身是 Electron + Pi SDK 通用），但 Godot 工具全部关掉就退化成普通 Agent，**没有差异化价值**。

**Q: 数据会同步到云吗？**
A: 不会。本机持久化（见 [数据位置](#数据位置)）。仅模型调用走你配置的 provider。

**Q: 升级会丢数据吗？**
A: 不会。升级保留 `~/.pi/agent/` 下所有内容。如需回滚到旧版，直接装旧 installer 覆盖。

## 反馈与贡献

- **Bug / 功能请求**：[Issues](../../issues)（Bug / Feature / Question 3 类模板）
- **安全漏洞**：[`SECURITY.md`](SECURITY.md) — **不要**在公开 Issue 贴复现
- **参与开发**：[`CONTRIBUTING.md`](CONTRIBUTING.md) / [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)
- **行为准则**：[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- **协议**：[`LICENSE`](LICENSE) (MIT)
- **维护节奏**：[`docs/maintenance.md`](docs/maintenance.md)
- **路线图**：[`docs/roadmap.md`](docs/roadmap.md)（22 里程碑 / 4 Phase）

变更记录见 [`CHANGELOG.md`](CHANGELOG.md)。开发与贡献说明见 [`CLAUDE.md`](CLAUDE.md)。

## 致谢

- 基于 [Pi SDK](https://pi.dev)
- 状态行动画：[thinking-orbs](https://github.com/JakubAntalik/thinking-orbs) (MIT © Jakub Antalik)
- Logo 预设：内部 8 套（霓虹赛博 / 熔岩灼烧 / 电浆雷霆 / 全息彩虹 / 玫瑰金金属 / 像素 8-bit / 故障 Glitch / 宇宙星云）

## 联系

| 渠道 | 联系方式 |
|---|---|
| 邮箱 | [fromlan@qq.com](mailto:fromlan@qq.com) |
| QQ 群 | `1074500101` |
