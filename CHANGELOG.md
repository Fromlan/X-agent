# Changelog

本文件记录 X-agent 面向用户的重要变更。版本号以 [`apps/desktop/package.json`](apps/desktop/package.json) 为准。

发版前须把下方 `Unreleased` 整理进对应 `## x.y.z` 章节；GitHub Release 正文由该章节生成（见 `scripts/prepare-release.mjs`）。

## Unreleased

## 0.2.4

### 改进

- **Godot 文档搜索**：结果带短摘要（summary）；类页 / 教程标题与排序更准确，概览可少读大 `.rst`
- **文档工具指引**：概览优先用 summary；API 查阅引导 `read(class_*.rst, limit)`

### 修复

- **右栏上下文占用**：按 prompt 侧 `input + cacheRead`（含 trailing 消息）计量，不再把上一轮 output 算进占用条
- **重载插件后工具全开**：`reload` 后重新应用用户工具白名单

### 开发

- 新增 `measure-context-baseline`：对比默认 7 工具与全开 19 工具的基线 token 估量，并纳入 `npm test`

## 0.2.3

### 功能

- **多风格 GUI 主题**：设置 → 通用可选默认 / Nord / Tokyo Night / Warm Paper / High Contrast；顶栏仍切换深浅；偏好为 `themeId` + `colorMode`（兼容旧 `theme` / `cindy`）
- **应用图标**：窗口 / 安装包 / 网页 favicon 使用统一品牌图标
- **顶栏紧凑布局**：窄窗时隐藏部分文案，保留图标与 title

### 改进

- 窗口最小尺寸下调，并隐藏应用菜单栏
- 侧栏 / 右栏在窗口缩小时自动让出聊天区宽度

### 文档

- DESIGN 补充主题族与可变样式令牌说明
- 同步 README / CLAUDE / AGENT_CONTEXT 与 0.2.x 能力说明；修正 Godot 设置入口文案

## 0.2.2

### 修复

- **CI / 发版测试**：`test-turn-file-tracker` 补上缺失的 `unlinkSync` 导入（symlink 用例在 Windows runner 上可用时不再 ReferenceError）

## 0.2.1

### 功能

- **会话用量与上下文面板**：右栏「上下文」展示占用进度、组成拆解（含协议损耗）、本轮 / 会话累计用量；支持手动压缩上下文
- **用量设置**：设置 → 用量，查看本地按日 / 按模型汇总，可清空统计
- **技能加载**：不再自动加载 `~/.agents/skills`，避免无关技能索引膨胀上下文

### 修复

- **组成拆解**：API 占用与文本估算的差额单独记为「协议损耗」，不再并入系统提示

## 0.2.0

### 功能

- **Godot 官方文档离线检索**：设置 → Godot →「官方文档」选择分支、打开下载链接并导入源码 zip；Agent 工具 `godot_docs_search` / `godot_docs_status`（默认关闭）
- **设置页整理**：Godot 拆成「编辑器连接 / 官方文档」子页签；通用 / 工具等分区卡片化；左侧导航带图标
- **工具分组一键开关**：启用工具各分组可用图标按钮整组开启 / 关闭

### 修复

- **新会话输入框偶发卡死**：切换 / 新建 / 恢复会话时清除编辑态，避免误锁输入
- **文档检索后读错路径**：搜索结果提供 `absPath`，并引导用 `read` 读本地缓存而非项目内 docs
- **Packages 安装区异常渐变**：供应商页 sticky 渐变不再误套到插件 Packages 面板

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
