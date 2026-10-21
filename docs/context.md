# X-agent 领域词表与模块索引

本页统一项目术语及主要实现位置。编码约束见 [AGENTS.md](../AGENTS.md)，工程流程见 [CLAUDE.md](../CLAUDE.md)，上下文组装见 [agent-context.md](agent-context.md)。下表中省略前缀的主进程文件位于 `apps/desktop/electron/agent/`。

## 核心概念

| 概念 | 含义 | 主要位置 |
|---|---|---|
| 对话实录保真 | 分支恢复与流式事件使用同一套展示规则，保留文本、工具配对、用户消息身份和截断语义；展示层不组装模型上下文 | `apps/desktop/shared/transcript/`、`session-event-bridge.ts`、`apps/desktop/src/stores/chat-store.ts` |
| 会话类型 | `code` / `design` 是会话级不可变策略，与会话模式正交；design 仅允许在项目的 `game-design/` 内写入 | `session-type-policy.ts`、`session-type-persistence.ts`、`session-mode/design-write-guard.ts` |
| 会话模式 | Agent / Ask / Plan / Goal 互斥；Ask 和 Plan 只读，Plan 额外允许 `write_plan`，Goal 按条件与预算评估续轮 | `session-mode/`、`apps/desktop/shared/mode-tools.ts` |
| 模式控制器 | 管理模式共享状态和互锁，委托 Ask / Plan / Goal 子控制器，并按会话类型合成工具集与提示 | `session-mode/controller.ts` |
| 工作区生命周期 | 打开、恢复、新建和关闭会话；候选会话初始化成功后才替换当前会话 | `session-lifecycle.ts`、`session-host.ts` |
| 工作区与回合分面 | `window.xAgent` 的 13 个功能分面；renderer 通过它们调用主进程，扁平 IPC 方法已移除 | `apps/desktop/shared/ipc-invoke-map.ts`、`apps/desktop/electron/preload.ts` |
| 项目侧栏身份 | 项目按规范化路径分组，并维护显示名、隐藏状态及会话删除后的回退 | `apps/desktop/shared/project-path.ts`、`apps/desktop/src/lib/group-sessions.ts` |
| 计划文件 | Plan 模式默认写入应用计划目录，可保存至项目 `.pi/plans/`；右栏负责编辑和执行入口 | `session-mode/plan-tools.ts`、`apps/desktop/src/components/right-panel/PlanTab.tsx` |
| 会话自动标题 | 首轮结束后确保会话有标题，由模型摘要或本地截断兜底 | `session-title.ts` |
| Godot RPC | 桌面主进程与 Godot 编辑器插件之间的本机 TCP JSON-lines 连接；查询、运行和检查通过此链路完成 | `godot-rpc-bridge.ts`、`godot-tools.ts`、`packages/godot-editor-rpc/` |
| godot-pi | 内置 Pi Package，提供 Core 技能、Godot 文档技能、提示模板和项目检测；与实时编辑器连接分别维护 | `packages/godot-pi/` |
| 应用更新 | 打包版检查、下载和安装 GitHub Release 安装包 | `auto-updater.ts`、`update-feed.ts`、`apps/desktop/src/hooks/useAppUpdate.ts` |

## 供应商与模型

| 概念 | 含义 | 主要位置 |
|---|---|---|
| 供应商启用开关 | 档案保存在本地；启用后同步到 Pi auth/models 并进入模型选择。关闭时，若无其他启用档案共用该 providerId，则清除相应 Pi 条目 | `provider-persist.ts`、`provider-pi-sync.ts` |
| 模型输入能力 | `input` 表示模型支持 `text` / `image`。未表态与显式开关分别处理；保存时补齐已知模型的默认值，并透传到 Pi `models.json`，不能假设底层自动保留 bundled vision 能力 | `provider-pi-models.ts`、`apps/desktop/src/lib/model-capability.ts`、`apps/desktop/src/components/settings/ProvidersSettingsPage.tsx` |
| 模型上下文上限 | 模型的 `contextWindow` 用于请求与上下文占用展示；预设、供应商结果及已知模型启发式参与补齐 | `apps/desktop/shared/model-context.ts` |
| DeepSeek 网络工具 | `web_search` / `web_fetch` 使用显式选择的 DeepSeek 官方档案，与聊天模型独立，默认关闭；按次费用目前不进入 Token 账本 | `deepseek-web-tools.ts`、`apps/desktop/shared/tools/web.ts` |

## 恢复与运行契约

| 概念 | 保证与限制 | 主要位置 |
|---|---|---|
| 撤回编排 | abort → scan → navigate → 文件恢复 → 剪枝 → 替换展示历史；scan 必须先于分支导航 | `retract-orchestrator.ts`、`restore-source.ts` |
| Shadow Git 检查点 | 优先恢复目标到 HEAD 之间变更过的文件；使用应用检查点目录中的独立 Git 数据，不修改用户 `.git`。无 Git 时降级为 write/edit 字节基线 | `shadow-git.ts`、`shadow-checkpoints.ts`、`turn-file-tracker.ts` |
| 撤回完成边界 | 检查点落盘和空闲维护完成后才发布 idle；空恢复路径不触发全量还原。同文件人工编辑、Bash 副作用与 Godot 内存态无法全部恢复 | `session-event-bridge.ts`、`auto-maintain.ts` |
| CWD 路径沙箱 | 同时检查路径段和真实目标，新文件解析最近存在父目录；仍存在检查后替换的竞态，不是操作系统级隔离 | `cwd-sandbox.ts`、`lib/path-boundary.ts` |
| 工具设置事务 | 串行等待保存与工具集应用；失败恢复旧状态，恢复失败明确报告 | `apply-tools.ts`、`apps/desktop/electron/ipc/register-prefs-ipc.ts` |
| Goal 证据与账本 | 评估关联工具调用、结果与错误；评估费用计入实际用量。预算是续轮停止阈值，暂停保留费用，撤回只回滚被放弃分支的预算 | `session-mode/goal-evaluator.ts`、`session-mode/goal-controller.ts`、`session-mode/goal-journal.ts` |
| 本地诊断包 | 匿名状态、操作枚举及耗时；最多保留 100 条事件和独立的最近失败状态。不含对话、源码、路径、密钥与原始错误正文，不自动上传 | `apps/desktop/electron/boot/diagnostics.ts`、`apps/desktop/shared/diagnostics.ts` |
| 模型探测传输 | 连接时检查 DNS，拒绝重定向，每候选 8 秒、2 MiB 上限；不代表 Pi SDK 的所有传输均受同一保护 | `public-http.ts`、`model-fetch.ts` |

## 打包范围

桌面 `extraResources` 包含应用图标、`packages/godot-editor-rpc/addons/x_agent_rpc` 与 `packages/godot-pi`，以 `apps/desktop/package.json` 为准。其他独立仓库的插件不随本应用发布；`package.json` 不添加构建 schema 不支持的注释字段。
