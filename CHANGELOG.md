# Changelog

本文件记录 X-agent 面向用户的重要变更。版本号以 [`apps/desktop/package.json`](apps/desktop/package.json) 为准。

发版前须把下方 `Unreleased` 整理进对应 `## x.y.z` 章节；GitHub Release 正文由该章节生成（见 `scripts/prepare-release.mjs`）。

升 **minor 线起点**（如 `0.3.0`，patch 为 0 且 minor > 0）时，`prepare-release` 会把上一线全部小版本（`0.2.0`…`0.2.x`）汇总写入本章节；GitHub Release 正文使用该章节（已含汇总则不再重复附加）。补丁版（如 `0.3.1`）不汇总。可用 `npm run release:notes -- 0.3.0` 预览，`--no-aggregate` 关闭自动附加。

## Unreleased

## 0.3.1

### 功能

- **Skill 斜杠菜单**：输入 `/` 弹出当前会话可用技能，筛选并插入 `/skill-name`
- **原生技能包分层**：`godot-pi` 含 Core（`x-*`）与 Godot 技能；非 Godot 项目不索引 `godot-*`；启动时尝试自动安装该包

### 改进

- **godot-pi**：精简大型玩法类默认技能，保留审计 / 场景 / RPC 试玩 / GDScript / 状态机等核心 Godot 技能；新增 `/x-next` 提示
- 设置 → 插件：一键安装文案改为「X-agent 原生技能包」

### 修复

- **聊天滚动**：贴底跟底不再吞掉卸钉；滚轮 / 滚动条 / 触控上翻后可离开底部，避免回弹卡住

## 0.3.0

### 功能

- **主题化下拉**：自定义 `SelectMenu` 替换原生 `<select>`（顶栏模型 / Thinking、设置内外观与 Godot / 供应商等），下拉面板跟随主题 token
- **发版 minor 汇总**：`0.3.0` 等线起点的 CHANGELOG / GitHub Release 自动纳入上一线（`0.2.0`…`0.2.x`）全部小版本说明

### 改进

- **聊天输入**：一体化 composer 壳（输入 + 发送 / 中止），焦点环包住整块
- **输入框**：全局单行 pill、只读淡化、多行统一圆角与焦点环；Shell 路径等宽
- **设置提示**：供应商 / 通用 / Godot / 插件 / 用量反馈可关闭；成功约 4.5s 自动消失；切页签与关窗清空，避免跨页粘滞

### 开发

- `extract-changelog` / `prepare-release` 支持上一 minor 线汇总；新增 `npm run release:test-changelog`


### 0.2.x 累计变更

以下为 0.2.0 起各小版本面向用户的说明汇总（新→旧）。

#### 0.2.6

### 改进

- **展示思考**：顶栏改为开关式 chip（「展示思考」+ 开/关徽标），开时高亮
- **默认深色**：Surface 加深至 `#141414`，启动窗背景与之对齐
- 空会话去掉 steer 提示；未打开项目时仍提示先选文件夹
- 右栏上下文去掉缓存命中率长脚注，面板更干净

### 修复

- **撤回**：navigate 前预扫变更文件，navigate 后再还原，避免撤回到用户消息时文件状态错乱
- **Godot 文档引用**：回答中用本地 `absPath` 反引号路径，不再改写成 `docs.godotengine.org` 链接

### 开发

- 加深架构接缝：对话实录 `transcript-mapper`、供应商激活、会话标题、cwd 沙箱、Godot / provider / session IPC 注册拆分；`App` 侧事件路由与撤回确认抽 hook

#### 0.2.5

### 功能

- **模型上下文窗口**：供应商档案模型可配置 `contextWindow`，写入 Pi `models.json`；预设 / 拉取 `/v1/models` / 已知模型启发式自动填入（如 DeepSeek V4 → 1M），避免一律按 Pi 默认 128k 计量占用
- **缓存命中率**：右栏上下文与设置 → 用量展示 `cacheRead / (input + cacheRead)`；改工具白名单时确认并提示会重建系统提示、清空本会话前缀缓存

### 改进

- 经 SiliconFlow 等非 `api.deepseek.com` 中转的 DeepSeek 模型，激活时自动写入 Pi `thinkingFormat: deepseek` compat，保证 `reasoning_content` 回传形态正确

### 文档

- `AGENT_CONTEXT` 补充前缀缓存注意点与 `contextWindow` 说明

#### 0.2.4

### 改进

- **Godot 文档搜索**：结果带短摘要（summary）；类页 / 教程标题与排序更准确，概览可少读大 `.rst`
- **文档工具指引**：概览优先用 summary；API 查阅引导 `read(class_*.rst, limit)`

### 修复

- **右栏上下文占用**：按 prompt 侧 `input + cacheRead`（含 trailing 消息）计量，不再把上一轮 output 算进占用条
- **重载插件后工具全开**：`reload` 后重新应用用户工具白名单

### 开发

- 新增 `measure-context-baseline`：对比默认 7 工具与全开 19 工具的基线 token 估量，并纳入 `npm test`

#### 0.2.3

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

#### 0.2.2

### 修复

- **CI / 发版测试**：`test-turn-file-tracker` 补上缺失的 `unlinkSync` 导入（symlink 用例在 Windows runner 上可用时不再 ReferenceError）

#### 0.2.1

### 功能

- **会话用量与上下文面板**：右栏「上下文」展示占用进度、组成拆解（含协议损耗）、本轮 / 会话累计用量；支持手动压缩上下文
- **用量设置**：设置 → 用量，查看本地按日 / 按模型汇总，可清空统计
- **技能加载**：不再自动加载 `~/.agents/skills`，避免无关技能索引膨胀上下文

### 修复

- **组成拆解**：API 占用与文本估算的差额单独记为「协议损耗」，不再并入系统提示

#### 0.2.0

### 功能

- **Godot 官方文档离线检索**：设置 → Godot →「官方文档」选择分支、打开下载链接并导入源码 zip；Agent 工具 `godot_docs_search` / `godot_docs_status`（默认关闭）
- **设置页整理**：Godot 拆成「编辑器连接 / 官方文档」子页签；通用 / 工具等分区卡片化；左侧导航带图标
- **工具分组一键开关**：启用工具各分组可用图标按钮整组开启 / 关闭

### 修复

- **新会话输入框偶发卡死**：切换 / 新建 / 恢复会话时清除编辑态，避免误锁输入
- **文档检索后读错路径**：搜索结果提供 `absPath`，并引导用 `read` 读本地缓存而非项目内 docs
- **Packages 安装区异常渐变**：供应商页 sticky 渐变不再误套到插件 Packages 面板

## 0.2.6

### 改进

- **展示思考**：顶栏改为开关式 chip（「展示思考」+ 开/关徽标），开时高亮
- **默认深色**：Surface 加深至 `#141414`，启动窗背景与之对齐
- 空会话去掉 steer 提示；未打开项目时仍提示先选文件夹
- 右栏上下文去掉缓存命中率长脚注，面板更干净

### 修复

- **撤回**：navigate 前预扫变更文件，navigate 后再还原，避免撤回到用户消息时文件状态错乱
- **Godot 文档引用**：回答中用本地 `absPath` 反引号路径，不再改写成 `docs.godotengine.org` 链接

### 开发

- 加深架构接缝：对话实录 `transcript-mapper`、供应商激活、会话标题、cwd 沙箱、Godot / provider / session IPC 注册拆分；`App` 侧事件路由与撤回确认抽 hook

## 0.2.5

### 功能

- **模型上下文窗口**：供应商档案模型可配置 `contextWindow`，写入 Pi `models.json`；预设 / 拉取 `/v1/models` / 已知模型启发式自动填入（如 DeepSeek V4 → 1M），避免一律按 Pi 默认 128k 计量占用
- **缓存命中率**：右栏上下文与设置 → 用量展示 `cacheRead / (input + cacheRead)`；改工具白名单时确认并提示会重建系统提示、清空本会话前缀缓存

### 改进

- 经 SiliconFlow 等非 `api.deepseek.com` 中转的 DeepSeek 模型，激活时自动写入 Pi `thinkingFormat: deepseek` compat，保证 `reasoning_content` 回传形态正确

### 文档

- `AGENT_CONTEXT` 补充前缀缓存注意点与 `contextWindow` 说明

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
