# Changelog

本文件记录 X-agent 面向用户的重要变更。版本号以 [`apps/desktop/package.json`](apps/desktop/package.json) 为准。

发版前须把下方 `Unreleased` 整理进对应 `## x.y.z` 章节；GitHub Release 正文由该章节生成（见 `scripts/prepare-release.mjs`）。

## Unreleased

### 变更

- **移除 Fleet**：删除多槽 `SessionHost`、并行实现+审阅编排、Fleet 条与双栏聊天；`main` 直接持有单个 `SessionHost`，`agent:event` 载荷为裸 `UiAgentEvent`

### 功能

- **右栏文件树右键菜单**：加入对话（`@相对路径`，发送时按 Pi 语义展开为 `<file>`）、在资源管理器中显示、复制路径 / 相对路径；菜单打开期间锁定选中高亮
- **Packages 列表**：与 `pi list` 对齐，优先读取 `settings.json` 的 `packages`
- **会话自动标题**：首轮结束后由 [`session-title.ts`](apps/desktop/electron/agent/session-title.ts) 派生可读名称
- **Godot Pi**：领域 skills 扩展（架构 / 玩法 / 导航 / 着色器等）；见 [`packages/godot-pi/README.md`](packages/godot-pi/README.md)

### 文档

- 同步 README / CLAUDE / AGENT_CONTEXT / DESIGN（去掉 Fleet）

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
