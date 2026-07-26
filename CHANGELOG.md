# Changelog

本文件记录 X-agent 面向用户的重要变更。版本号以 [`apps/desktop/package.json`](apps/desktop/package.json) 为准。

发版前须把下方 `Unreleased` 整理进对应 `## x.y.z` 章节；GitHub Release 正文由该章节生成（见 `scripts/prepare-release.mjs`）。

## Unreleased

## 0.1.6

### 功能

- **侧栏从项目移除**：分组头可「从侧栏移除」工作区（仅隐藏，会话文件保留；再次打开项目后重新出现）
- **工具面板**：展示已启用工具列表（含 Godot）；设置内补充说明
- **教程环境重置脚本**：`scripts/reset-tutorial-env.ps1` / 双击 bat，清空 `~/.pi` 并卸载全局 Pi CLI

### 修复

- **删除当前/唯一会话**：始终删除会话文件，不再静默新建空会话；同项目有其它会话则切到最近一条
- **启用 Godot 工具后不生效**：创建会话时注册完整可切换工具集，避免后续勾选被白名单静默忽略
- **供应商启用后无可用模型**：外部写入 `auth.json` 后同步刷新 AuthStorage 缓存
- **Windows 安装 Pi CLI**：对含空格路径（如 `C:\Program Files\...`）正确加引号后再 spawn

## 0.1.5

### 功能

- **对话撤回 / 编辑重发 / 重新生成**：基于 Pi 会话树 `navigateTree`；默认还原该段 `write`/`edit` 文件改动（bash / Godot 副作用除外）
- **撤回后原文回填输入框**，可直接改完再发
- 确认弹窗列出可还原文件与风险提示

### 修复

- 文件还原改为在会话树导航成功后再执行，避免导航取消时磁盘已被回滚

## 0.1.4

### 变更

- **移除 Fleet**：删除多槽 `SessionHost`、并行实现+审阅编排、Fleet 条与双栏聊天；`main` 直接持有单个 `SessionHost`，`agent:event` 载荷为裸 `UiAgentEvent`；清理残留源码与测试

### 功能

- **右栏文件树右键菜单**：加入对话（`@相对路径`，发送时按 Pi 语义展开为 `<file>`）、在资源管理器中显示、复制路径 / 相对路径；菜单打开期间锁定选中高亮
- **侧栏会话按项目分组**
- **Packages**：列表与 `pi list` 对齐；**卸载**改为执行 `pi uninstall` 并同步本地记录
- **会话自动标题**：首轮结束后由 [`session-title.ts`](apps/desktop/electron/agent/session-title.ts) 派生可读名称
- **Godot Pi**：领域 skills 扩展（架构 / 玩法 / 导航 / 着色器等）；见 [`packages/godot-pi/README.md`](packages/godot-pi/README.md)

### 修复

- **对话框中文**：恢复主进程文件选择对话框与相关错误提示的中文文案（此前编码损坏为 `???`）

### 文档

- 同步 README / CLAUDE / AGENT_CONTEXT / DESIGN（单会话架构、右栏 Tools / Files / Godot）
- 移除未使用的 `ClientPrefs.language` 字段

## 0.1.3

### 功能

- **Godot RPC**：`play_main_scene`、`import_resources`；多编辑器客户端选路；对应 Agent 工具与设置项
- **Godot Pi**：skills 深化（含 `godot-rpc-playtest`）；设置 → 插件 → 一键安装
- **插件**：Themes / Packages 管理收入 **设置 → 插件**（顶栏独立插件页已移除）
- **认证与更新**：设置 → 通用「打开 Pi 登录」；打包版 `electron-updater`（GitHub Releases）
- **Fleet**：多 `SessionHost` + 顶栏 Fleet 条切换工作区

### 修复

- **设置弹窗**：固定高度，切页签不再跳动；修复插件页等内容被裁剪

### 文档与发布

- 同步 README / CLAUDE / 各包说明与当前功能
- Release 正文改为取自 CHANGELOG 对应版本章节（`scripts/prepare-release.mjs` / `extract-changelog.mjs`）

## 0.1.2

- 桌面客户端基线：会话、供应商、工具白名单、Godot RPC 控制面（开/重载/运行当前场景与错误收集）、CI / Windows Release
