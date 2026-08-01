# X-agent

[中文](README.md) · [English](README.en.md)

面向 **Godot 4** 的桌面编码 Agent，基于 [Pi](https://pi.dev)。

在项目里改场景与脚本、通过编辑器 RPC 重载 / 运行 / 导入，并离线检索官方文档——同一套会话里完成。当前版本见 [`apps/desktop/package.json`](apps/desktop/package.json)。

## 定位

| | |
|---|---|
| 是什么 | Godot 专用的编码 Agent（Electron 桌面客户端） |
| 不是什么 | 通用多语言 IDE 替代品；Godot 只是其中一个插件 |
| 工作面 | 项目文件 + Godot 编辑器控制面 + 官方文档检索 |
| 运行时 | 复用 Pi 认证与模型；会话与 Pi CLI 隔离 |

## 功能

### Godot

- **编辑器 RPC** — 开/重载场景、运行当前或主场景、资源导入、多编辑器选路、运行报错回传；默认端口 `8765`（回退 `8765–8774`）
- **官方文档** — 导入文档源码或 zip 后离线检索（需在工具中启用）
- **Godot Pi 包** — 领域 skills / prompts（设置 → 插件可一键安装）
- **右栏 Godot** — 桥接连接状态与快捷操作
- **项目就绪清单** — 认证 / bash·Git / RPC 插件 / Godot 工具 / 文档等一步引导；可「不再提醒」

### Agent 与会话

- **聊天** — 打开项目、续会话、流式中 steer / 中止；Thinking；`@路径` 引用文件（发送后以芯片展示，可展开）
- **会话模式** — 输入区 **Agent | 调研 | Plan | 目标** 四模式互斥切换
  - **Agent** — 常规编码（工具白名单内）
  - **Plan** — 只读研究 + `write_plan`；右栏「计划」可编辑 / 保存到项目；审阅后点「执行计划」切回 Agent 实施；tool_call 硬闸防误写
  - **目标（Goal）** — 设定完成条件，独立评估未达标则自动续轮
- **会话** — 按项目分组；恢复 / 重命名 / 删除；自动标题；可从侧栏隐藏项目
- **对话编辑** — 撤回、编辑重发、重新生成；优先用 Shadow Git 检查点还原工作区（独立于用户 `.git`），无 Git 时降级为还原该段 `write` / `edit` 基线；撤回前有确认与风险提示
- **技能可见** — `read` 加载 `SKILL.md` 时显示为「技能 · 名称」卡片
- **右栏** — 上下文占用拆解与手动压缩、**计划**、工具详情、项目文件树（Markdown 可预览）、Godot 状态

### 配置与运维

- **供应商** — 多档案订阅、拉取模型列表；可导入 Pi / cc-switch 配置；DeepSeek 等模型 Thinking 档位自动钳制与修复
- **插件** — Prompt / Skill / Extension / Theme / Packages
- **工具白名单** — 内置读写与终端默认开；Godot 编辑器 / 文档工具默认关，可按组开关；临时只读用会话「调研」或 Plan（不改设置勾选）
- **用量** — 本地用量汇总（设置 → 用量）
- **认证** — 应用内 Pi 登录引导
- **主题** — 深色默认 / 浅色；设置与顶栏可切换
- **更新** — 安装版启动后静默检查 GitHub Releases；设置内检查 / 下载 / 安装；失败时可打开 Releases 浏览器下载

## 环境要求

- Windows（当前提供安装包）
- Godot **4.x** 项目（使用编辑器控制面时）
- Node.js 22+（仅从源码开发时需要）
- 可用的模型认证（任选）：
  - **设置 → 供应商** 新建并启用
  - **设置 → 通用** →「打开 Pi 登录」
  - 本机已登录 [Pi CLI](https://pi.dev)
- 终端类工具：建议安装 [Git for Windows](https://git-scm.com/download/win)，或在设置中指定 bash 路径（`shellPath`）

## 使用

1. 打开应用，**打开项目**选择 Godot 工程目录（默认续该项目最近会话）
2. 顶栏选择模型与 Thinking，按需切换 **Agent / 调研 / Plan / 目标**（也可 Shift+Tab 循环），发送指令
3. 使用 Godot 控制面时：
   - **设置 → 工具** 勾选 Godot 编辑器 / 文档工具
   - **设置 → Godot → 编辑器连接**：安装/启用 **X-agent RPC** 插件，保持桥接已连接
   - （可选）**设置 → 插件** 一键安装 Godot Pi 包；**设置 → Godot → 官方文档** 导入文档源码
4. 左侧管理历史；右栏查看上下文、计划、工具、文件与 Godot 状态
5. Plan 流程：切到 Plan → 描述任务 → Agent 研究后写出计划 → 右栏审阅/编辑 →「执行计划」

| 设置分页 | 内容 |
|---|---|
| 通用 | 主题、Thinking 默认、bash、Pi 登录、自动更新 |
| 供应商 | 模型供应商档案与导入 |
| 用量 | 本地用量汇总 |
| 工具 | 工具白名单、分组开关（Agent/目标默认能力；临时只读用会话模式） |
| 插件 | 提示词 / 技能 / 扩展 / 主题 / Packages |
| Godot | **编辑器连接** · **官方文档** |

## 数据位置

应用数据在 `~/.pi/agent/` 下：

| 路径 | 用途 |
|---|---|
| `x-agent.json` | 客户端偏好 |
| `x-agent/sessions/` | 本应用会话（与 Pi CLI 隔离） |
| `x-agent/checkpoints/` | Shadow Git 工作区检查点（按项目隔离） |
| `x-agent/plans/` | Plan Mode 默认计划文件（可保存到 `<cwd>/.pi/plans/`） |
| `x-agent-providers.json` | 供应商档案 |
| `x-agent-godot-rpc.json` | Godot RPC endpoint（含握手 token） |
| `x-agent/goals/` | Goal 模式日记（删除会话时清理） |
| `x-agent-packages.json` | Packages 安装记录 |
| `x-agent-usage.json` | 用量统计 |
| `x-agent/godot-docs/` | Godot 文档缓存 |
| `auth.json` / `models.json` | 与 Pi 共用的认证与模型 |

## 相关包

| 包 | 说明 |
|---|---|
| [`packages/godot-editor-rpc`](packages/godot-editor-rpc) | Godot 编辑器 RPC 插件 |
| [`packages/godot-pi`](packages/godot-pi) | Godot 领域 skills 与 prompts |

## 更新与安装信任

- **自动更新**：安装版启动后会静默检查 **GitHub Releases**；也可在设置 → 通用手动检查 / 下载 / 安装。检查失败时可点「打开 Releases」在浏览器下载（网络不稳时可用下方交流渠道）。
- **代码签名**：打包时若环境提供 `CSC_LINK`（证书文件/base64）与 `CSC_KEY_PASSWORD`，electron-builder 会自动签名，减轻 SmartScreen 拦截。未配置证书时仍可产出未签名安装包。

## 安全与隐私

编码 Agent 默认具备较强本机能力，请按需收紧：

| 面 | 说明 |
|---|---|
| API Key | 供应商密钥在 `x-agent-providers.json` 中尽量用 Electron `safeStorage` 加密；激活时仍写入 Pi `auth.json`；勿把该目录同步到不可信位置 |
| 工具 | 默认开启 `bash` / `write` / `edit`；会话「调研」/ Plan 硬闸关闭 write/edit，bash 仅放行只读命令且路径须在项目 cwd 内（不写回设置）；设置 → 工具控制 Agent/目标默认白名单 |
| 项目沙箱 | 右栏文件树与调研/Plan 的 bash 受 cwd 约束；Agent 模式下 Pi `bash` 仍可能访问更广路径 |
| Godot RPC | 仅监听 `127.0.0.1`；endpoint 含共享 token，插件 `editor_ready` 握手校验后才接受调用。握手失败时请更新并重启编辑器内 `x_agent_rpc` 插件 |
| Packages | `pi install` 可安装任意来源包，注意供应链风险 |
| 会话 | 仅存储在 `~/.pi/agent/x-agent/sessions/`，与 Pi CLI 会话隔离；Goal journal 在 `~/.pi/agent/x-agent/goals/` |

变更记录见 [`CHANGELOG.md`](CHANGELOG.md)。开发与贡献说明见 [`CLAUDE.md`](CLAUDE.md)。Plan / Goal 设计调研见 [`docs/research-plan-goal-modes.md`](docs/research-plan-goal-modes.md)。

## 交流与反馈

欢迎反馈问题、建议与使用体验：

| 渠道 | 联系方式 |
|---|---|
| 邮箱 | [fromlan@qq.com](mailto:fromlan@qq.com) |
| QQ 群 | `1074500101` |
