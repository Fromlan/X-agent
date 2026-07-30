# X-agent

[中文](README.md) · [English](README.en.md)

面向 **Godot 4** 的桌面编码 Agent，基于 [Pi](https://pi.dev)。

在项目里改场景与脚本、通过编辑器 RPC 重载 / 运行 / 导入，并离线检索官方文档——同一套会话里完成。

## 定位

| | |
|---|---|
| 是什么 | Godot 专用的编码 Agent（Electron 桌面客户端） |
| 不是什么 | 通用多语言 IDE 替代品；Godot 只是其中一个插件 |
| 工作面 | 项目文件 + Godot 编辑器控制面 + 官方文档检索 |
| 运行时 | 复用 Pi 认证与模型；会话与 Pi CLI 隔离 |

## 功能

### Godot

- **编辑器 RPC** — 开/重载场景、运行当前或主场景、资源导入、多编辑器选路、运行报错回传
- **官方文档** — 导入文档源码后离线检索（需在工具中启用）
- **Godot Pi 包** — 领域 skills / prompts（设置 → 插件可一键安装）
- **右栏 Godot** — 桥接连接状态与快捷操作

### Agent 与会话

- **聊天** — 打开 Godot 项目、续会话、流式中 steer / 中止；Thinking；`@路径` 引用文件
- **会话** — 按项目分组；恢复 / 重命名 / 删除；自动标题；可从侧栏隐藏项目
- **对话编辑** — 撤回、编辑重发、重新生成；默认还原该段对文件的 `write` / `edit`
- **右栏** — 上下文占用与压缩、工具详情、项目文件树

### 配置与运维

- **供应商** — 多档案订阅、拉取模型列表；可导入 Pi / cc-switch 配置
- **插件** — Prompt / Skill / Extension / Theme / Packages
- **工具白名单** — 内置读写与终端默认开；Godot 编辑器 / 文档工具默认关，可按组开关
- **用量 / 认证 / 更新** — 本地用量汇总；应用内 Pi 登录；安装版可从 GitHub Releases 检查更新

## 环境要求

- Windows（当前提供安装包）
- Godot **4.x** 项目（使用编辑器控制面时）
- 可用的模型认证（任选）：
  - **设置 → 供应商** 新建并启用
  - **设置 → 通用** →「打开 Pi 登录」
  - 本机已登录 [Pi CLI](https://pi.dev)
- 终端类工具：建议安装 [Git for Windows](https://git-scm.com/download/win)，或在设置中指定 bash 路径

## 使用

1. 打开应用，**打开项目**选择 Godot 工程目录（默认续该项目最近会话）
2. 顶栏选择模型与 Thinking，发送指令
3. 使用 Godot 控制面时：
   - **设置 → 工具** 勾选 Godot 编辑器 / 文档工具
   - **设置 → Godot → 编辑器连接**：安装/启用 **X-agent RPC** 插件，保持桥接已连接
   - （可选）**设置 → 插件** 一键安装 Godot Pi 包；**设置 → Godot → 官方文档** 导入文档源码
4. 左侧管理历史；右栏查看上下文、工具、文件与 Godot 状态

| 设置分页 | 内容 |
|---|---|
| 通用 | 主题、Thinking 默认、bash、Pi 登录、自动更新 |
| 供应商 | 模型供应商档案与导入 |
| 用量 | 本地用量汇总 |
| 工具 | 工具白名单与分组开关 |
| 插件 | 提示词 / 技能 / 扩展 / 主题 / Packages |
| Godot | **编辑器连接** · **官方文档** |

## 数据位置

应用数据在 `~/.pi/agent/` 下：

| 路径 | 用途 |
|---|---|
| `x-agent.json` | 客户端偏好 |
| `x-agent/sessions/` | 本应用会话（与 Pi CLI 隔离） |
| `x-agent-providers.json` | 供应商档案 |
| `x-agent-godot-rpc.json` | Godot RPC endpoint |
| `x-agent-usage.json` | 用量统计 |
| `x-agent/godot-docs/` | Godot 文档缓存 |
| `auth.json` / `models.json` | 与 Pi 共用的认证与模型 |

## 相关包

| 包 | 说明 |
|---|---|
| [`packages/godot-editor-rpc`](packages/godot-editor-rpc) | Godot 编辑器 RPC 插件 |
| [`packages/godot-pi`](packages/godot-pi) | Godot 领域 skills 与 prompts |

## 更新与安装信任

- **自动更新**：安装版启动后会静默检查 **GitHub Releases**；也可在设置 → 通用手动检查 / 下载 / 安装。检查失败时可点「打开 Releases」在浏览器下载（大陆网络不稳时可用加群通道）。
- **代码签名**：打包时若环境提供 `CSC_LINK`（证书文件/base64）与 `CSC_KEY_PASSWORD`，electron-builder 会自动签名，减轻 SmartScreen 拦截。未配置证书时仍可产出未签名安装包。

## 安全与隐私

编码 Agent 默认具备较强本机能力，请按需收紧：

| 面 | 说明 |
|---|---|
| API Key | 供应商密钥明文保存在 `~/.pi/agent/x-agent-providers.json`，启用时写入 Pi `auth.json`；勿把该目录同步到不可信位置 |
| 工具 | 默认开启 `bash` / `write` / `edit`；设置 → 工具可用「只读安全档」关闭终端与写文件 |
| 项目沙箱 | 右栏文件树受 cwd 沙箱约束；Pi `bash` 仍可在 shell 中访问更广路径 |
| Godot RPC | 仅监听 `127.0.0.1`，当前无共享密钥握手；仅信任本机编辑器连入 |
| Packages | `pi install` 可安装任意来源包，注意供应链风险 |
| 会话 | 仅存储在 `~/.pi/agent/x-agent/sessions/`，与 Pi CLI 会话隔离 |

变更记录见 [`CHANGELOG.md`](CHANGELOG.md)。开发与贡献说明见 [`CLAUDE.md`](CLAUDE.md)。
