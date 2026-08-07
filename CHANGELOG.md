# Changelog

本文件记录 X-agent 面向用户的重要变更。版本号以 [`apps/desktop/package.json`](apps/desktop/package.json) 为准。

发版前须把下方 `Unreleased` 整理进对应 `## x.y.z` 章节；GitHub Release 正文由该章节生成（见 `scripts/prepare-release.mjs`）。

升 **minor 线起点**（如 `0.3.0`，patch 为 0 且 minor > 0）时，`prepare-release` 会把上一线全部小版本（`0.2.0`…`0.2.x`）汇总写入本章节；GitHub Release 正文使用该章节（已含汇总则不再重复附加）。补丁版（如 `0.3.1`）不汇总。可用 `npm run release:notes -- 0.3.0` 预览，`--no-aggregate` 关闭自动附加。

## Unreleased

（占位：下个版本的变更说明）

## 0.4.1

### 变更

- **架构 · IPC 单一事实源**：`shared/ipc.ts` 新增 `IpcInvokeMap`——87 个 invoke 通道的权威签名（channel 名 → 参数 → 返回），preload 转发与主进程 handler 注册都由它派生，`XAgentApiFlat` 从 90 个手工签名收敛为 `Omit<FlatInvokeApi, DeletedFlatKey> & 3 特例`；preload 约 176 行手工转发改为循环生成（`makeInvokeApi`）；主进程侧新增类型锚定的 `handle()` 注册器，6 个 `register-*-ipc.ts` 全部接入。「新增/改名 IPC 必须同步四处」的人肉约定由编译期断言接管（通道键 ↔ 映射键全覆盖、删除名单合法性），漏同步从运行期静默失败变为编译期报错。
- **架构 · 门面收尾与死代码清理**：删除 7 个从未接线的分面类型（`ProjectApi` / `GodotApi` / `PluginsApi` / `ProvidersApi` / `PackagesApi` / `UsageApi`）；`window.xAgent` 扁平面按 `DELETED_FLAT_KEYS` 收窄 36 个零消费者方法（`openProject` / `prompt` / `setModel` 等全部迁到分面），renderer 侧 4 处调用方迁移到 `session` 分面；删除 `messagesToHistory`（无生产消费者）、`provider-activate.ts` 兼容壳与 `activateProviderProfile`（IPC 通道已下线，测试改走生产路径 `setProviderProfileEnabled`）、`register-session-ipc.ts` 纯组合器。
- **架构 · 撤回还原接缝**：`ShadowCheckpointTracker`（git 检查点）与 `TurnFileTracker`（write/edit 基线）两个真实还原适配器之间建立共享接口 `RestoreSource`（preview / restore / kind），编排器经 `CompositeRestoreSource` 调度（优先级、失败降级、警告合并、bash/Godot 不可还原增强统一收敛）——新增还原源不再改编排器。
- **架构 · 存储事务化**：新增深模块 `Store<T>`（`lib/store.ts`），`mutate(fn)` 把「读-改-写 + 原子写 + 缓存」整体放进锁内；prefs / usage / provider 三处存储迁移，修复并发 patch 丢更新残留（此前锁只包写、读在锁外）；Pi 侧 `auth.json` / `models.json` 由裸写改为原子写 + per-path 锁。
- **架构 · 转录贴底输入判定加深**：ChatTranscript 内 7 组原生事件监听里的「输入 → 取消贴底」判定（滚轮向上 / PageUp/Home/ArrowUp / touch 上滑 8px）抽为纯函数模块 `src/lib/chat-unpin-input.ts`（复用 `chat-scroll-pin` 几何谓词，不复制），行为测试 `test-chat-unpin-input` 接入 `npm test` 链。
- **架构 · 会话宿主接口瘦身**：按消费方真实使用统计裁剪 3 个零消费 host 接口项（`getResourceLoader` / `getBaseAppendPrompt` / `setBaseAppendPrompt`），假想接缝宽度 51 → 48。

### 功能

- **godot_detect_project 抽模块 + Plan / Ask 默认放行**：godot-pi 扩展把 `godot-helpers.ts` 里的 `project.godot` 探测拆为独立 `godot-project-detect.ts`（纯 fs 解析器，无 Pi 依赖，方便单测）；`shared/mode-tools.ts` 新增 `PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS` 常量，将 godot-pi Package 注册的扩展只读工具与 prefs 开关解耦——Plan / Ask 模式默认放行 `godot_detect_project`，调研场景不再需要先在设置勾选。

### 测试

- **新增 Vitest 覆盖**：`lib/store.test.ts`（20 并发 mutate 无丢更新回归）、`restore-source.test.ts`（调度优先级 / 降级 / 警告合并 6 用例）、`register-ipc.test.ts`（通道注册表一致性 + 注册器转发）；离线测试链新增 `test-chat-unpin-input.ts`、`test-godot-detect-project.ts`（8 用例锁住 `project.godot` 解析契约）、`test-inject-splash-version.ts`（9 用例覆盖占位符 / 幂等 / mismatch / checkOnly / 边界 markup）。

### 改进

- **底部工具条重构**：将「模型 / Thinking / 展示思考」三组设置从 TopBar 移到 ChatPanel 底部工具条，与既有的 4 个会话模式 pill（智能体 / 调研 / 计划 / 目标）合并为单行布局；删除原有的 `.composer-mode-bar` 独立行与 `.composer-hint` 提示文案，模式 pill 拆除外层圆角容器改为独立 pill。响应式断点重写：≤1280px 隐藏字段标签、≤900px 模式行独占一行、≤700px 模式 pill 文字隐藏仅图标，统一由 `.composer-actions` 的 `margin-left: auto` 把发送按钮锚到工具条右侧，避免窄屏时「发送」单独换行落到第三行。
- **底部工具条强制两行**：`.composer-toolbar` 改为 grid（`1fr auto` × 2 行，`mode-row` 跨满整行），模式按钮恒占第 1 行、模型设置 + 发送按钮恒占第 2 行，告别「窄屏下发送按钮单独换到第 3 行」的抖动；`composer-model-row` 内部 `flex-wrap: nowrap` 锁住「模型 + Thinking + 展示思考」一行不拆。
- **侧栏 / 工具栏宽度钉死区间**：`SIDEBAR_WIDTH_MAX` 480 → 269、`RIGHT_PANEL_WIDTH_MIN/MAX` 240-640 → 400-507、`RIGHT_PANEL_WIDTH_DEFAULT` 360 → 480 落在新区间内；老 prefs 越界值加载时由 `clampWidth` 自动夹紧。
- **composer-shell 模式色边框**：`.composer-shell` 加 `data-mode` 钩子，按当前会话模式（智能体 / 调研 / 计划 / 目标）映射到 `accent-blue / ctx-messages / ctx-skills / accent-yellow` 四色，与模式 pill 复用同一调色板；默认淡 35% 混合、hover 65%、focus 实色 + 30% box-shadow，当前模式一眼可见。
- **启动页版本号自动注入**：splash.html 静态 `v0.3.12` 易落后版本号；新增 `scripts/inject-splash-version.ts`（`package.json` `predev` / `prebuild` 钩子）从 `version` 字段注入 `v…` 标记，占位符首次替换、后续版本号漂移自动改写、`--check-only` 留给 CI 校验；离线测试 `test-inject-splash-version.ts` 锁住占位符 / 幂等 / mismatch / checkOnly / 边界 markup 9 条契约。
- **ROADMAP 阶段调整**：移除 1.3 跨平台（macOS / Linux）阶段（聚焦 Windows 单一平台），对应调整 1.3 i18n / 1.4 Godot 项目 lint / 1.5 @-补全 / 1.6 E2E 契约锁 编号表述与 mermaid 依赖图；其余验收项不变。

## 0.4.0

### 功能

- **Godot 工具扩展（1.2 全量）**：新增 7 个编辑器工具（Godot 插件 0.5.0）——`godot_get/set_project_setting`（读写 project.godot 配置）、`godot_lint_scripts`（GDScript 静态检查，带行号）、`godot_find_unused_resources`（未使用资源扫描）、`godot_export_project`（headless 子进程出包，不阻塞编辑器）、`godot_get_debugger_state` / `godot_set_breakpoint`（调试器状态与断点，会话启动自动重放）。只读工具进入 Ask / Plan 模式白名单，写型工具计入撤回告警。

### 修复

- **@-补全空白路径误判**：`looksLikePathCandidate` 正则未锚定，`"foo bar"` 等含空白片段被误判为路径候选（该测试曾因未纳入 vitest 而从未运行，0.4.0 激活后暴露）。
- **会话重命名过期提交**：编辑会话名后 120ms 内点击其他会话，会提交过期编辑；现焦点落在会话列表内时跳过提交（onResume 负责切换）。
- **Godot 面板轮询闭包陈旧**：`GodotTab` 轮询依赖缺失导致闭包引用旧 refresh；已 useCallback 化并补全依赖。
- **渲染期写 ref**：`App.tsx` 在渲染函数体内写入 `apiStatusRef`，并发渲染下可能中断；改为 effect 同步。

### 改进

- **依赖全量升级**：Electron 35 → 43、Vite 6 → 7、Vitest 2 → 4、TypeScript 5.9 → 7.0（移除 `baseUrl`，paths 相对化）、electron-vite 3 → 5、`@earendil-works/pi-coding-agent` 0.80 → 0.83（`ModelRuntime.reloadConfig` 迁移到 `refresh()`）；Playwright E2E 在 Electron 43 下通过。
- **死代码清理（0.4.0 梳理）**：删除 7 个无引用文件（`history.ts` / `transcript-mapper.ts` / `SkillSlashMenu` / `skill-slash` / 3 个 barrel index）、约 15 个无消费者导出（`loadPrefsAsync` / `getAllowedPluginRoots` / `syncActiveProfileToPi` 等）、2 条无人调用的 IPC 链路（`activateProviderProfile` / `listSessionSkills`）、preload 6 个 renderer 零使用分面、`syncedActive` 等过期字段。
- **测试体系收敛**：退役 4 组双重覆盖的离线脚本（cwd-sandbox / usage-store / godot-rpc-bridge / shadow-checkpoints），由 Vitest 独占；vitest 纳入 `src/**` 并激活 `at-completion` 测试；补 `project-fs` / `mode-tools` / `mode-prompt` 覆盖（覆盖率 60% 门槛 → 实际 82%+）；删除重复的「重置教程环境.bat」。
- **重复实现收敛**：`THINKING_LEVELS` / `applyTheme` 收敛到单点（`@shared/ipc` / `src/lib/theme.ts`）；`WRITE_PLAN_TOOL` 统一 import 自 `shared/mode-tools.ts`。


### 0.3.x 累计变更

以下为 0.3.0 起各小版本面向用户的说明汇总（新→旧）。

#### 0.3.14

### 功能

- **@ 补全菜单**：聊天输入框输入 `@` 弹出三类候选（技能 / 会话模式 / 文件路径），选中即插入，长列表带键盘导航与排序去重（`useAtCompletion` + `AtMenu`）。
- **Godot 场景内省**：新增 `get_scene_tree` / `get_node_properties` 两个 RPC 方法（Godot 插件 0.4.0），Agent 可直接查看当前场景的节点树与节点属性，为场景级编辑提供上下文。
- **连续工具调用折叠**：同一回合的连续 tool 调用自动折叠为可展开批次，长工具序列不再占满对话；运行中的批次不自动展开，完成后可一键展开 / 收起（`ToolBatch` + `test-tool-batches` 契约锁定）。

### 修复

- **确认弹窗「第一次点击无效果」**：在工具白名单切换等需要 confirm 的场景下，用户快速连续点击切换按钮（或自动批处理、键盘连按等）会让前一次的 await confirm(...) 永远不 resolve —— pendingRef.current 被新调用覆盖，前一次的 resolve 函数丢失，表现为「要点两次确认才生效」。src/lib/app-confirm.tsx 新 confirm 启动前先把旧的 pending resolve 为 false，避免 Promise 泄露。新增 scripts/test-confirm-provider.ts 锁住合约。
- **Godot RPC 断开后无法自动重连**：桥接关闭期间插件每次重连都重置回主端口，fallback 端口（8765–8774）从未被遍历（本机端口无监听是立即 RST，不会走连接超时推进路径），桥接重启后端口 / token 变化时插件永远连不上。插件 0.4.1 重写重连调度：每次重连前重读 endpoint 感知配置变化、同一端口连续重试约 2s 后推进下一候选端口、重连间隔缩短到 0.5s，桥接重启后 0.5–1s 内自动恢复，无需重启编辑器；Godot 设置页同步增加桥接状态轮询，连接 / 断开实时可见。
- **Plan 内联 `<clarify>` 解析**：模型输出带 markdown 包裹的内联 clarify 块时按块边界解析而不是整段吞掉，选项可正常点选发送（`test-plan-clarify` 锁定）。

### 改进

- **Plan 澄清面板重设计**：多题 clarify 选项面板重构选中态 / 间距 / 布局，误触率下降、可见性提升。
- **bash 健康探针 + 设置诊断**：设置页新增 bash 环境诊断，显示 liveness 探测结果与 shell 路径问题，排查更快。
- **工程化 · CI 门槛**：引入 Vitest 单测（node 环境，含 cwd-sandbox / retract-orchestrator / shadow-checkpoints / usage-store / godot-rpc-bridge 关键模块）+ Playwright E2E 基础用例（应用外壳 / 模式切换），CI 增加测试与覆盖率门槛。
- **文档**：新增 `AGENTS.md` 仓库协作入口 + `ROADMAP.md`（1.1 / 1.6 完成标记），开发者与 Agent 上手路径补齐。

#### 0.3.13

### 改进

- **Godot RPC 自动重连**：X-agent 启动时优先复用上次 endpoint 的 token 与端口，已运行的 Godot 插件通常无需任何操作即可在 ~1s 内握手成功（Godot 插件 0.3.0+ 每秒轮询 endpoint 文件 mtime，变更即跳到正确端口）。就绪清单 `rpcBridge` 状态新增 8s 启动宽限；区分「握手失败 → 更新 RPC 插件」与「未连接 → 启动编辑器」，并透出 `lastHandshakeFailure` 与插件版本号。`stop()` 不再删除 endpoint 文件（崩溃 / `taskkill` 路径行为对齐）。0.2.0 旧插件仍能工作，只是不上报 `addonVersion`。
- **调试模式**：开发运行默认打开独立 DevTools；打包版可用 `--x-agent-debug` / `--debug-ui` 或 `X_AGENT_DEBUG=1` 开启，并支持 `F12`、`Ctrl+Shift+I` 切换。
- **启动页**：移除硬编码灰底，改用 `transparent` + HTML 自绘圆角背景，Win11 22H2+ 同时启用 DWM 原生 `roundedCorners`；加载完成 320ms 淡出再 reveal 主窗口，避免视觉跳变。

### 修复

- **长对话消息显示混乱**：对话一旦超过一屏（达到虚拟列表阈值）后，流式追加、assistant 收尾、中间插入 tool 行等路径都出现过行重叠 / 错位。根因是 `ChatTranscript` 在「行数变化」与「status 切换」两个 `useLayoutEffect` 里调用全量 `virtualizer.measure()`，它会清空 tanstack 的整个 `itemSizeCache`，已挂载行全部退回估算高度，长行之后的下一行仍按 estimate 定位造成重叠。现改为依赖新挂载行 ref 实测 + 内部 ResizeObserver 校正，并新增 `test-chat-virtual-cache` 契约测试锁住「禁止全量重测」。
- **气泡 / 工具调用被裁剪**：虚拟行的 `overflow: hidden` 会裁掉连续折叠工具条的紧凑负边距与流式内容，操作头也会被相邻的 transform 行盖住。现改为行盒允许可见溢出，不再为气泡预留布局空间；由行本身按消息顺序反向叠放，并在展开 / 悬停时提升到顶层，让气泡按约定覆盖下方内容；`test-chat-transcript-virtual` 锁住该层叠与溢出契约。
- **Godot RPC 就绪清单离线分支**：原 `bridgeInGrace` 条件在桥接未启动时也会判为「在宽限期」，导致「启动 RPC 桥接」入口漏出。修正后仅当桥接在跑且未超过 8s 才视为宽限内。
- **Godot RPC 端口回退测试**：用 `withIsolatedEndpoint` 隔离 endpoint 文件，避免开发者机器上残留的 endpoint 让端口回退测试改走本机目录。

#### 0.3.12

### 功能

- **更新提示**：安装版静默检查到新版本时不自动下载，应用内提示条「立即更新 / 稍后」并在顶栏显示入口，引导用户按需下载或安装。

### 变更

- **架构 · 主进程 IO 与校验加固**：prefs / usage / provider / auth / godot-rpc 五处持久化改为原子写（tmp + rename），prefs 与 usage 改走 `withStoreLock(path, ...)` 串行化（与 provider 同模式）；safeStorage 不可用时启动一次 probe 并在 UI 横幅告知「密钥以明文存储」；`setPrefs` 走 `ClientPrefsPatchSchema`（`additionalProperties: false`）拒绝未声明字段；`external-url` 显式拒绝 IPv4-mapped IPv6 / link-local / ULA / zone-id；`cwd-sandbox` 与 `plan-tools` 路径前缀比对做 Windows 大小写归一化；`applyBashShellPath` 写入前对 target 做 `--version` 自检。`bash-readonly` / `plan-mode-guard` / `plan-tools` / `goal-evaluator` / `goal-journal` / `session-mode` 6 个废弃入口合并到 `session-mode/*`。
- **UI 拆分**：`PluginsPage`（805 → 90）/ `Sidebar`（528 → 105）拆到 `./plugins/` `./sidebar/` 子目录，顶层只保留壳与 re-export 兼容；`ChatTranscript` virtualizer 配置抽到 `src/lib/chat-transcript-virtual.ts`，5 个 bubble 子组件抽到 `./chat/bubbles.tsx`；`ChatPanel` 拆出 `useSlashMenu` hook 并加 `React.memo` 顶层包装。

### 改进

- **会话模式切换**：智能体 / 调研 / 计划 / 目标四种模式统一使用中文标签，并以蓝 / 青 / 紫 / 黄图标和同色选中态区分；补充 hover、禁用与 `aria-pressed` 状态，保留 `Shift+Tab` 快捷切换。
- **供应商启用约束**：始终保留至少一个启用档案；最后一个启用档案不能被关闭、删除或保存为禁用，设置页会直接解释原因，避免模型列表被清空。
- **发版流程**：本机 `release:dist` 改为可选冒烟；用户下载的权威产物以 CI GitHub Release 为准。
- **工程化**：新增 `apps/desktop/.editorconfig`（UTF-8 / LF / 2 空格缩进 / 去行尾空格 / 末尾换行），停止跟踪 `*.tsbuildinfo`，并将供应商认证缓存回归测试纳入完整测试链。
- **开发文档**：新增 `AGENT.md` 仓库协作指南；同步 `CONTEXT.md` / `CLAUDE.md` 的模块路径与发版约定；补充 Godot TileSet 结构格式调研，并明确本地 ADR / 调研草稿不参与发布。

### 修复

- **prefs 并发丢更新**：`savePrefs` 加 `withStoreLock(path, ...)` 串行化，并发 `patchPrefs` 不再读到同一快照后写覆盖前写；`usage-store` 同步去掉自管 `writeQueue`，统一走 `withStoreLock`。
- **供应商同步与模型过滤**：`providerId` 与 Pi 配置 key 漂移时，按 `baseUrl` 家族回退匹配并清理 `auth.json` / `models.json`，顶栏不再残留已停用模型；启用路径改为静态 ESM 导入，修复打包后切换供应商时的 `Cannot find module`。
- **供应商认证状态缓存**：新增或删除供应商写入 `auth.json` 后主动失效 `checkAuth` 缓存，ReadyChecklist 不再继续误报「未配置供应商」。
- **Windows 发布产物覆盖**：NSIS 安装包与 Portable 便携包使用独立文件名，避免后构建的便携包覆盖安装包，确保 `latest.yml` 的大小与 SHA-512 可用于自动更新校验。

#### 0.3.11

### 修复

- **对话卡顿 + 流式期间无法浏览历史**：流式增量每帧都触发整树 ReactMarkdown 全量重解析 + 强制关闭虚拟化 + 双 rAF 抢回 scrollTop，三者叠加导致长文本流式期间主线程被吃满、用户拖滚动条被强抢。MarkdownBody 在 streaming 时降级到 plain `<pre>`，assistant_end 后一次解析定型；长对话在 streaming 期也走虚拟列表（≥ 24 条）；用 IntersectionObserver 观察尾节点，pinned 才 follow，未 pinned 绝不抢滚动条。

### 改进

- **App / ChatPanel 回调 memo 化**：把传进 ChatPanel / Sidebar 的 inline lambda 全部 `useCallback` 化；TopBar / Sidebar 加 `React.memo`，流式事件不再触发无关组件重渲染。MarkdownBody / UserMessageBody / ToolRow 内部的 `JSON.stringify` / `splitUserMessageFileBlocks` 用 `useMemo` 缓存。

#### 0.3.10

### 功能

- **插件 · 技能开关**：设置 → 插件 → 技能可逐项 / 批量启用或关闭；`disabledSkills` 黑名单持久化，关闭后不进入会话索引与 `/skill` 菜单

### 变更

- **Godot 文档**：移除内置离线文档工具 / 缓存与设置页「官方文档」；改为 `godot-pi` 的 `godot-docs-4-7` 技能（仅 Godot 项目索引）。优化后的 Godot 技能已能很好替代原查询文档能力；基于精简 tool 的原则，去除文档检索工具。
- **godot-pi**：删除细粒度 `godot-*` 惯例技能，统一由文档技能覆盖

### 改进

- **Godot 设置**：页签仅保留编辑器连接与 RPC
- **就绪清单 / 工具白名单**：去掉 Godot 文档工具相关项

### 修复

- **技能页白屏**：旧偏好缺少 `disabledSkills` 时不再崩溃；列表项改为合法 DOM（checkbox 不再嵌在 button 内）

#### 0.3.9

### 修复

- **Ask/Plan bash 硬闸**：按换行切段；拒绝 `$()` / 反引号 / `${}` 命令替换；`godot` / `dotnet` 不再视为只读
- **Goal 预算**：撤回后回滚 `turns` / `tokensUsed`，避免双计；续轮改为 settled 外异步 prompt，避免嵌套竞态
- **会话边界**：`prompt` / `abort` 校验 session bundle epoch，切换/释放会话后不再写错检查点
- **打开项目**：忽略按钮把 `MouseEvent` 当成路径传入导致打开失败
- **Plan 右栏**：切换计划时立即清空旧 markdown，避免短暂串显
- **文件树**：刷新不再并发双 IPC
- **工具卡片**：`tool_update` 在完成后忽略迟到的 partial，避免覆盖最终结果
- **Godot 文档**：选「自定义…」只展开输入，不再立刻用当前分支空调一次

### 改进

- **发送体验**：用户消息乐观气泡（Shadow 检查点完成前即可看见）
- **安全收紧**：Godot RPC method allowlist；外链拒绝本地/私网地址；`will-navigate` 拒绝非本应用 `file:`；`pi install` 跳过 npm lifecycle scripts；单实例锁
- **性能**：流式 `text_delta` / `thinking_delta` 尾部 O(1) 更新；无变化时跳过全量 `history_replace`
- **代码审查**：见 `0.3.8` 之前提交 / `git log --since=2026-08-01`；分诊结论已落入上面各条

#### 0.3.8

### 功能

- **Goal 护栏**：轮次 + token 双预算（`goalMaxTurns` / `goalMaxTokens`）、暂停 / 继续、评估失败自动暂停；日记落盘 `~/.pi/agent/x-agent/goals/`（删会话时清理）
- **Plan / 调研**：bash 只读分类器 + 项目 cwd 路径硬约束；`<clarify>` 多题点选后「发送所选」；计划 todos 勾选；Shift+Tab 循环模式
- **供应商密钥**：`x-agent-providers.json` 尽量用 Electron `safeStorage` 加密（启用时仍写入 Pi `auth.json`）
- **Godot RPC 握手**：endpoint 共享 token，插件 `editor_ready` 校验通过后才接受调用

### 改进

- **顶栏模型**：编辑启用订阅后同步 Pi models；去重 case 变体；下拉仅显示模型名；Thinking / 模型选择居中与首字母大写
- **设置**：目标最大轮次 / token；Shell 说明区分调研·Plan cwd 闸与 Agent 模式
- **文档 / ADR**：Ask·Plan bash 闸门、goals 路径、密钥与 RPC 握手说明；`docs/adr/` 补齐

### 修复

- **Ask/Plan bash**：禁止 python/node 任意执行与 `find -delete` 等突变；拦截目录外路径
- **供应商**：保存已启用档案时避免重复 activate
- **澄清 UI**：由单点即发改为逐题选择后统一发送

#### 0.3.7

### 功能

- **调研模式 (Ask)**：与 Agent / Plan / 目标并列；只读研究与问答（无 `write_plan`）；临时工具集 + 硬闸，不写回设置白名单

### 改进

- **工具设置**：移除「快捷档 / 只读安全档」；临时只读引导至会话「调研」或 Plan；设置页仅控制 Agent/目标默认白名单
- **会话架构**：`SessionModeController` / `RetractOrchestrator` 从 `SessionHost` 拆出；IPC `workspace` / `turn` / `plan` 分面
- **长对话**：聊天转录虚拟列表（`@tanstack/react-virtual`）；SelectMenu 滚动定位更稳

#### 0.3.6

### 功能

- **Plan Mode**：只读研究 + `write_plan`；右栏「计划」可编辑 / 保存到项目；「执行计划」切回 Agent 实施；tool_call 硬闸防误写
- **Goal Mode**：与 Agent / Plan 并列；完成条件 + 独立评估续轮，直至条件满足

### 改进

- **Plan 指令**：system append 注入（不污染用户气泡）；先研究再一次写出完整计划，拒绝 placeholder / 过短 stub；同会话修订覆盖当前计划文件
- **模式切换**：切换 Agent / Plan / Goal 时保留已有计划在右栏，需「清除引用」才丢掉

### 修复

- **工具卡片收起**：结束后强制折叠；修复受控 `<details>` 与 Chromium toggle 抢状态导致卡住展开
- **write_plan 注册**：自定义工具列入 session 白名单；新建会话后正确激活 Plan 工具集

#### 0.3.5

### 功能

- **文件预览 Markdown**：右栏「文件」对 `.md` / `.mdx` / `.markdown` 默认渲染（GFM），可切换源码
- **技能调用可见**：聊天中 `read` 加载 `SKILL.md` 时显示为「技能 · 名称」卡片，而非普通工具

### 改进

- **默认 Thinking 为 high**：更贴合 DeepSeek V4 等仅支持 off/high/max 的模型；打开/新建会话强制应用默认档，并回写钳制后的生效值
- **DeepSeek models.json**：为自定义 id（如 `deepseek-v4-pro[1M]`）补写 `reasoning` / V4 `thinkingLevelMap`，启动时修复缺字段的旧条目，避免 Thinking 被钳成 off
- **引用文件缩略**：发送后的 `<file>` 块在对话与撤回回填输入框中显示为 `@路径` 芯片（可展开）
- **对话吸底跟随**：未上翻时持续跟随最新；仅向上滚动取消跟随，避免布局抖动误取消

### 修复

- **开发环境安装 Godot RPC 插件**：兼容 electron-vite `out/main/chunks` 路径，正确找到仓库内 `packages/godot-editor-rpc`
- **打包版 addon 路径**：优先使用 `extraResources` 内置插件，避免 cwd 落在 monorepo 时误拷开发树

#### 0.3.4

### 功能

- **Shadow Git 工作区撤回**：有本机 Git 时，每轮 prompt 前打独立检查点（`~/.pi/agent/x-agent/checkpoints/`，不写用户 `.git`）；撤回 / 编辑重发优先 `reset` 到该轮 pre，覆盖 write/edit/bash 等 cwd 内改动；无 Git 时仍降级为 write/edit 字节基线
- **撤回确认**：展示还原模式（Shadow / 基线）、可还原路径与风险提示；Godot 仅对会改编辑器状态的工具告警

### 修复

- **检查点绑定时机**：Pi 在 `message_end` 之后才持久化用户消息；改为在 append 之后（`queueMicrotask` / `tool_execution_start`）绑定 active user 与 Shadow pre，避免基线与检查点绑到错误轮次导致「缺少 Shadow / 缺基线」

### 改进

- **测试**：`test-shadow-git`、`test-session-bind-timing`；文档补充撤回 / 检查点路径说明

#### 0.3.3

### 变更

- **移除 Gitee 更新源**：删除设置内更新源切换、发版 CI / `sync-gitee-release` 同步；自动更新仅使用 GitHub Releases
- **就绪清单**：关闭仅本会话隐藏；新增「不再提醒」才对本项目持久关闭 Godot 相关步骤

### 功能

- **更新体验**：打包版启动后静默检查；顶栏更新角标；设置内「打开 Releases」浏览器下载回退
- **偏好恢复**：启动时若 `x-agent.json` 损坏则备份并提示；设置 Escape / `Ctrl+,`；上下文自动压缩阈值；工具「只读安全档」

### 改进

- **设置**：供应商页拆出 `ProvidersSettingsPage`；就绪 / 更新逻辑抽 hook
- **文档**：README 补充安全与隐私说明；Godot 文档导入引导（镜像 / 本地 zip）
- **测试**：prefs recovery、update-feed resolve

#### 0.3.2

### 功能

- **项目就绪清单**：单一可折叠条替代多层横幅（认证 / bash / RPC / Godot 工具 / 文档）；桥接启动有明确反馈，等待连入时可一键启动编辑器
- **空聊天引导**：打开项目后展示 starter prompts，并可跳转 Godot / 设置
- **Godot 工具渐进启用**：桥已连接但工具仍关时提示一键启用
- **主题化确认框**：替换系统 `window.confirm`；warn/danger 默认高亮「取消」

### 改进

- **长会话聊天**：超过阈值时折叠更早消息；流式/长历史时对非尾部气泡降级为纯文本渲染
- **设置分页拆分**：通用 / 工具 / Godot 独立页面组件；Settings 壳层变薄
- **更新与签名说明**：README / CLAUDE / 设置补充 GitHub 自动更新与可选 Windows 代码签名（`CSC_LINK`）
- **工程**：`SessionHost` 拆出 helpers / event-bridge / usage；IPC channel 常量表；`project-fs` 与 Electron shell 解耦；sandbox / ready-checklist / update-feed 测试

#### 0.3.1

### 功能

- **Skill 斜杠菜单**：输入 `/` 弹出当前会话可用技能，筛选并插入 `/skill-name`
- **原生技能包分层**：`godot-pi` 含 Core（`x-*`）与 Godot 技能；非 Godot 项目不索引 `godot-*`；启动时尝试自动安装该包

### 改进

- **godot-pi**：精简大型玩法类默认技能，保留审计 / 场景 / RPC 试玩 / GDScript / 状态机等核心 Godot 技能；新增 `/x-next` 提示
- 设置 → 插件：一键安装文案改为「X-agent 原生技能包」

### 修复

- **聊天滚动**：贴底跟底不再吞掉卸钉；滚轮 / 滚动条 / 触控上翻后可离开底部，避免回弹卡住

#### 0.3.0

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
