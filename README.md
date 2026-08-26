<h1 align="center">X-agent</h1>

<p align="center">
  <img src="docs/screenshots/main-window.png" alt="X-agent 主界面" width="480"/>
</p>

<p align="center">
  <strong>Godot 4 项目的桌面编码 Agent：同会话里改代码、跑场景、撤回到任意一步。</strong>
</p>

<p align="center">
  <a href="https://github.com/Fromlan/X-agent/releases/latest"><img src="https://img.shields.io/github/v/release/Fromlan/X-agent?label=latest" alt="Latest Release"/></a>
  <img src="https://img.shields.io/badge/status-Early%20Beta-orange" alt="Status: Early Beta"/>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Fromlan/X-agent" alt="License: MIT"/></a>
  <a href="https://github.com/Fromlan/X-agent/stargazers"><img src="https://img.shields.io/github/stars/Fromlan/X-agent?style=flat" alt="GitHub Stars"/></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-blueviolet" alt="Platform: Windows 10/11"/>
  <img src="https://img.shields.io/badge/Godot-4.x-478cbf" alt="Godot 4.x"/>
</p>

<p align="center">
  <a href="#install">安装</a> ·
  <a href="#what-is-x-agent">三大支柱</a> ·
  <a href="#x-agent-vs">对比</a> ·
  <a href="docs/agent.md">开发文档</a> ·
  <a href="docs/roadmap.md">路线图</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="https://github.com/Fromlan/X-agent/issues">反馈</a>
</p>

<p align="center">
  <a href="README.md">🇨🇳 简体中文</a> | <a href="README.en.md">🇺🇸 English</a>
</p>

---

> **Early Beta**：活跃开发中，体验可能粗糙。

> 不是 AGI，但是是 Godot 桌面 Agent 这个细分里**差异化最强**的一个：Godot 编辑器 RPC 联动 + Shadow Git 撤回 + 4 模式 2 类型硬闸。

## Install

**Windows**（当前唯一支持的桌面平台）：

- **下载安装包**：[GitHub Releases](https://github.com/Fromlan/X-agent/releases/latest) — 选 `X-agent-Setup-x.y.z.exe` 下载双击安装
- **应用内更新**：装好之后启动会自动静默检查新版本（在设置 → 通用手动 / 顶栏入口也能检查）

**macOS / Linux**：等发版——见 [ROADMAP §1.3](docs/roadmap.md)。开发者可从源码跑（见下方"从源码开发"）。

## 30 秒上手

1. **打开应用**，**打开项目**选你的 Godot 工程根目录
2. **登录认证**：设置 → 通用 → "打开 Pi 登录"（或本机 `pi login` 已登录即可）
3. （可选）**接 Godot 编辑器**：设置 → Godot → 编辑器连接 → 安装 **X-agent RPC** 插件 → 编辑器内启用 `x_agent_rpc`
4. 输入框写 prompt，按 Enter

更深入：[角色场景](#你要用-x-agent-做什么) / [设置总览](#设置) / [键盘快捷键](#键盘快捷键)。

## What is X-agent?

X-agent 做三件其他 Agent 没做好的事：**Godot 深度联动**、**可信任的撤回**、**模式硬闸**。每条都链到 [docs/agent.md](docs/agent.md) 详细机制。

### 🎮 Godot 深度联动

- **编辑器 RPC（TCP）** — Agent 直接驱动当前 Godot 编辑器：开/重载场景、运行当前或主场景、跑完收集报错回传。默认端口 `8765`（回退 `8765–8774`），多编辑器显式选路。详见 [docs/agent.md §七](docs/agent.md)
- **17 个 Godot 工具** — 场景内省（节点树 / 属性）/ 调试器（断点 / 状态）/ 资源治理（unused / lint / 导入）/ 导出（headless 子进程）/ 配置读写（`project.godot`）/ 只读内省（全局类 / export 模板 / UID 解析）
- **godot-docs-4-7 技能** — Pi 自动发现并入 `<available_skills>`；按需 `read` 加载 SKILL.md，**0 token 浪费在"用不上的方法论"上**
- **就绪清单** — 首次开 Godot 项目时一键引导（认证 / bash / RPC 插件 / Godot 工具 / 文档）

### ↩️ 可信任的撤回

- **Shadow Git 检查点**（每轮 prompt 前打独立检查点，独立于你项目里的 `.git`）→ 撤回 / 编辑重发 / 重新生成时按 diff 路径还原，**不会吞掉你回合期间的手动编辑**。无 Git 时降级为 `write` / `edit` 字节基线
- **Diff 预览**（0.5.3+）—— 每轮结束在回复下方展示 `+/-` 着色 diff（带文件数与 `+N` / `-N` 统计）；撤回确认弹窗额外显示"将被还原的内容" diff，逐行确认
- **断点不重写**：会话跨恢复不丢 Shadow 状态

### 🔀 4 模式 + 2 类型硬闸

- **会话模式（互斥切换）**：
  - **Agent** —— 常规编码（默认白名单内）
  - **Ask / 调研** —— 只读问答；硬闸关 `write` / `edit` / `write_plan`；`bash` 仅放行只读命令且路径须在项目 cwd 内
  - **Plan** —— 只读研究 + `write_plan`；右栏可编辑 / 保存到项目 / 「执行计划」切回 Agent
  - **Goal** —— 写完成条件 + 独立评估；轮次 + token 双预算，未达标自动续轮
- **会话类型（与模式正交）**：
  - **`code`**（默认，写入无限制）
  - **`design`** —— 写操作**硬约束**到 `<cwd>/game-design/`，UI 切暖色主题；预装 5 个内置 skill：`design-initiation` / `design-process` / `design-systems` / `design-numerical` / `design-core-loop`

## 你要用 X-agent 做什么？

四个常见场景，按"我是什么角色"选：

### 🎮 Godot 开发者 · 改代码 + 跑场景
打开项目 → Agent 模式 → 选模型 → 问"在 `Player.gd` 加冲刺功能，跑一下当前场景" → Agent 改文件、编辑器 RPC 重载、跑场景、报错回传，**都在同一会话**。

### ✍️ 独立策划 · 写设计文档（不污染 game/）
新会话选 **design 类型** → 写只允许落到 `<cwd>/game-design/` → 预装 5 个内置 design skill 帮你做立项 / 数值 / 核心循环 → UI 切暖色主题与代码会话区分。

### 🔬 研究只读 · 问 API、查文档
切 **调研 (Ask) 模式** → 工具集硬闸关 `write` / `edit` → `bash` 仅放行只读命令且路径须在项目 cwd 内 → 适合"先摸清 GDScript 单例怎么写再动手"。

### 🎯 目标驱动 · 让 Agent 自己跑到完成
切 **目标 (Goal) 模式** → 写完成条件（如"在 `ScoreManager.gd` 加 combo 计数 + HUD 显示"） → 评估未达自动续轮（轮次 + token 双预算）。

## 关键能力一览

| 能力 | 版本 | 用户能看到什么 |
|---|---|---|
| **🎯 策划会话 design 类型** | 0.5.5 | 写只允许落到 `<cwd>/game-design/`，UI 暖色主题 |
| **🛠 5 个内置 design skill** | 0.5.5 | 立项 / 流程 / 系统 / 数值 / 核心循环懒写即用 |
| **🎨 8 套品牌 logo + 自定义** | 0.5.5 | 设置 → 通用 → 品牌（霓虹赛博 / 熔岩灼烧 / …） |
| **🎨 v1.1 elevation 设计语言** | 0.5.4 | Composer 唯一主元素，三栏降为低调 chrome |
| **⚡ Diff 显示** | 0.5.3 | 撤回前 `+/-` 着色 diff，带 `+N` / `-N` 统计 |
| **🔮 thinking-orbs 状态行动画** | 0.5.2 | 运行中粒子轨道而非转圈 |
| **📜 godot-docs-4-7** | 0.4.x | 引擎惯例技能，按需 `read` |
| **↩️ Shadow Git 撤回** | 0.4.x | 每轮检查点，按 diff 路径还原 |
| **🎯 4 模式 + 2 类型硬闸** | 0.3.6+ | Agent / Ask / Plan / Goal × code / design |
| **🧠 Thinking 档位 + 模型钳制** | 0.2.5+ | DeepSeek 等自动钳制，编辑器实时反馈 |

完整 CHANGELOG：[`CHANGELOG.md`](CHANGELOG.md)。

## 三个必知概念

- **会话模式**（互斥）：Agent / Ask / Plan / Goal —— 决定**能用什么工具**
- **会话类型**（独立）：`code` / `design` —— 决定**写操作的作用域**
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

## 从源码开发

开发者文档：[`docs/agent.md`](docs/agent.md) / [`CLAUDE.md`](CLAUDE.md)

```bash
git clone https://github.com/Fromlan/X-agent.git
cd X-agent
cd apps/desktop
npm install
npm run dev          # Electron 开发
npm test             # 离线断言链
npm run test:unit    # vitest
npm run typecheck    # tsc 两个 tsconfig
```

发版流程：见 [`CLAUDE.md` §7](CLAUDE.md#7-发版流程)。

## 路线图

22 个里程碑 / 4 个 Phase。当前阶段：

- ✅ **Phase 1** 工程质量 + Godot 深化（1.1 Vitest+Playwright / 1.2 7 个 Godot 工具 / 1.4 Lint / 1.5 @ 补全 / 1.6 E2E 契约锁）
- 🛑 **1.3 i18n 基础** —— 已废弃（单兵项目，英文文档由 README.en.md 承担，UI 仍中文 only）
- ⏳ **Phase 2** UX 打磨：会话导出 / 开发者诊断 / Plan 模板 / A11y
- ⏳ **Phase 3** 差异化：主题编辑器 / 快捷键中心 / 多项目工作区
- ⏳ **Phase 3.4** macOS / Linux 安装包

完整路线图：[`docs/roadmap.md`](docs/roadmap.md)

## 反馈与贡献

- **Bug / 功能请求**：[Issues](../../issues)（Bug / Feature / Question 3 类模板）
- **安全漏洞**：[`SECURITY.md`](SECURITY.md) — **不要**在公开 Issue 贴复现
- **参与开发**：[`CONTRIBUTING.md`](CONTRIBUTING.md) / [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)
- **行为准则**：[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- **协议**：[`LICENSE`](LICENSE) (MIT)
- **维护节奏**：[`docs/maintenance.md`](docs/maintenance.md)

## 致谢

- 基于 [Pi SDK](https://pi.dev) — 上下文组装 / 会话 / compaction 的核心
- 状态行动画：[thinking-orbs](https://github.com/JakubAntalik/thinking-orbs) (MIT © Jakub Antalik)
- Godot 文档：[godot-docs-4-7](https://godotengine.org/) 索引
- 灵感来源：[Karpathy 关于 LLM Knowledgebase 的思考](https://x.com/karpathy/status/2039805659525644595)

## 联系

| 渠道 | 联系方式 |
|---|---|
| 邮箱 | [fromlan@qq.com](mailto:fromlan@qq.com) |
| QQ 群 | `1074500101` |

---

<p align="center">
  <sub>如果 X-agent 帮到你，<a href="https://github.com/Fromlan/X-agent">点个 ⭐ Star</a> 让更多人看到。</sub>
</p>
