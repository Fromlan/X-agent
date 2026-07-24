# Changelog

本文件记录 X-agent 面向用户的重要变更。版本号以 [`apps/desktop/package.json`](apps/desktop/package.json) 为准。

发版前须把下方 `Unreleased` 整理进对应 `## x.y.z` 章节；GitHub Release 正文由该章节生成（见 `scripts/prepare-release.mjs`）。

## Unreleased

### 功能

- **Fleet 并行编排**：`fleetStartPair` / `fleetAbortPair`；worker+reviewer 双波次（Wave1 并行实现与风险清单，Wave2 基于 git diff / staged / status / 会话摘录审阅）；**完成 = Wave2 审阅结束**；`beginPrompt` 避免整轮阻塞 UI
- **分槽独立对话**：`agent:event` 带 `slotId`；renderer `itemsBySlot`；存在实现+审阅且非主会话时左右双栏展示（优先绑定 pair 槽）
- **Fleet 条**：添加审阅、移除槽、每槽 busy、编排相位与中止
- **会话自动标题**：首轮结束后由 [`session-title.ts`](apps/desktop/electron/agent/session-title.ts) 派生可读名称（剥离 Fleet 角色包装）
- **Godot Pi**：领域 skills 扩展（架构 / 玩法 / 导航 / 着色器等）；见 [`packages/godot-pi/README.md`](packages/godot-pi/README.md)

### 文档

- 同步 README / CLAUDE / [`packages/fleet/README.md`](packages/fleet/README.md)

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
