# X-agent 领域词表

维护者与架构加深共用的概念名。接缝与模块以这些词指称，避免与文件名偶然碰撞混淆。

| 概念 | 含义 | 主要落点 |
|------|------|----------|
| **对话实录保真** | Pi 分支 / 流式 → 同一套 `HistoryItem` 规则（文本、工具配对、`userEntryId`、截断） | `shared/transcript/`（`branch-mapper` / `apply-events` / `truncate`）；Electron 直播接线在 `session-event-bridge.ts`；renderer `chat-store.ts` 为薄 re-export |
| **撤回撤销** | 撤回到用户消息：abort → scan → navigate → 文件还原 → 剪枝 → history replace。所有编排走 `CompositeRestoreSource` seam（3-method `RestoreSource` interface：preview / restore + kind/label/fallbackWarning；composite 暴露 `scan` 作为第 4 个 seam 方法，duck-type 派发到 baseline source）。`scan 必须在 navigate 之前`这条不变量集中在 `restore-source.ts` 顶部 + `retract-orchestrator.ts` 顶部两处文档化。`TurnFileTracker.previewRestore` / `restorePaths` / `restoreSegment` / `restoreSince` 与 `ShadowCheckpoints.previewRestore` 全部改 `private`，外部统一走 `preview` / `restore` / `scan` seam 方法。 | `retract-orchestrator.ts`（编排）、`restore-source.ts`（seam + composite）、`turn-file-tracker.ts` / `shadow-checkpoints.ts`（适配器）；renderer 走 `turn.*` |
| **会话模式** | Agent / 调研(Ask) / Plan / Goal 互斥生命周期：只读工具快照、system append、`write_plan`、目标评估续轮（预算 / 暂停 / journal） | `electron/agent/session-mode/`（`controller` + plan/goal/bash 内部 adapter）；工具常量与默认 `write_plan` 在 `shared/mode-tools.ts`，session-mode 内部实现主位于 `electron/agent/session-mode/plan-tools.ts` |
| **会话类型** | `code` / `design` 会话级不可变抽象（与 mode 正交）：design 写只允许 `<cwd>/game-design/`，内部 4 mode 可互切。所有 type 决策集中在 `electron/agent/session-type-policy.ts` 的 `SessionTypePolicy` 深模块（5 方法：toolPreset / systemAppend / shouldBlockWriteTool / filterSkills / persistenceSchema；`CodePolicy` / `DesignPolicy` + 工厂 `createSessionTypePolicy` 集中 DEFAULT 兜底）。底层实现保留在原位：类型定义 `shared/session-type.ts`；持久化 `electron/agent/session-type-persistence.ts`（sidecar 原子写）；system append 注入 `shared/mode-prompt.ts#buildDesignSessionTypeAppend`；写约束 `electron/agent/session-mode/design-write-guard.ts`（与 plan-mode-guard 并列，policy.shouldBlockWriteTool 委托 guard）；工具派生 `shared/session-type-tools.ts` + `plan-tools.computeModeToolsForType`（policy 参数化）；`SessionModeController.composeModeAppend` 注入 type-level append |
| **供应商启用开关** | 档案保存在本地；`enabled` 时 sync 进 Pi auth/models，关闭时若无其它启用档案共用 providerId 则 prune；顶栏只列已启用；legacy `activate` = 设启用 + sync + 切模型 + 回滚 | `provider-persist.ts`（`setProviderProfileEnabled`）+ `provider-pi-sync.ts`；兼容事务见 `provider-activate.ts`；预设/导入见 `provider-presets` / `provider-import`（`provider-store.ts` 为 barrel） |
| **会话自动标题** | 首轮结束后确保会话有标题（模型摘要或本地截断） | `session-title.ts`（`ensureSessionTitle`） |
| **项目侧栏身份** | 按项目 key 分组 / 隐藏 / 显示名 / 删除后回退会话 | `shared/project-path.ts`、`group-sessions.ts`、`useWorkspaceSession.ts` |
| **Cwd 路径沙箱** | 解析项目内相对路径，拒绝逃出 cwd | `electron/agent/cwd-sandbox.ts` |
| **工作区 / 回合门面** | 跨进程粗操作面：`workspace` / `turn` / `plan` / `session` / `prefs` / `updates` 6 个分面（扁平方法仍保留兼容；新代码优先分面） | `shared/ipc.ts`、`preload.ts`；IPC handler 按模块拆为 8 个 `register-*-ipc.ts`（`workspace` / `turn` / `plan` / `session` / `session-config` / `provider` / `godot` / `update`）|
| **工作区生命周期** | open / resume / dispose / createSession 编排 | `session-lifecycle.ts`；`SessionHost` 组合壳转发 |
| **计划会话** | 右栏计划 CRUD、脏保存、执行计划、自动打开 Plan 页 | `usePlanSession.ts`、`PlanTab.tsx` |
| **应用更新 UX** | 打包版检查 / 下载 / 安装 / 横幅 dismiss | `useAppUpdate.ts`；主进程 `auto-updater.ts` + `update-feed.ts`；IPC `register-update-ipc.ts` |

相关：[`agent-context.md`](agent-context.md)（模型上下文如何组装）、[`CLAUDE.md`](CLAUDE.md)（仓库指引）。项目内不再保留 `docs/adr/` 子目录。
