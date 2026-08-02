# X-agent 领域词表

维护者与架构加深共用的概念名。接缝与模块以这些词指称，避免与文件名偶然碰撞混淆。

| 概念 | 含义 | 主要落点 |
|------|------|----------|
| **对话实录保真** | Pi 分支 / 流式 → 同一套 `HistoryItem` 规则（文本、工具配对、`userEntryId`、截断） | `shared/transcript/`（`branch-mapper` / `apply-events` / `truncate`）；Electron 直播接线在 `session-event-bridge.ts`；renderer `chat-store.ts` 为薄 re-export |
| **撤回撤销** | 撤回到用户消息：abort → scan → navigate → 文件还原 → 剪枝 → history replace | `retract-orchestrator.ts`（编排）、`turn-file-tracker.ts` / `shadow-checkpoints.ts`（还原适配器）；renderer 走 `turn.*` |
| **会话模式** | Agent / 调研(Ask) / Plan / Goal 互斥生命周期：只读工具快照、system append、`write_plan`、目标评估续轮（预算 / 暂停 / journal） | `electron/agent/session-mode/`（`controller` + plan/goal/bash 内部 adapter）；工具常量 `shared/mode-tools.ts` |
| **供应商启用开关** | 档案保存在本地；`enabled` 时 sync 进 Pi auth/models，关闭时若无其它启用档案共用 providerId 则 prune；顶栏只列已启用；legacy `activate` = 设启用 + sync + 切模型 + 回滚 | `provider-persist.ts`（`setProviderProfileEnabled`）+ `provider-pi-sync.ts`；兼容事务见 `provider-activate.ts`；预设/导入见 `provider-presets` / `provider-import`（`provider-store.ts` 为 barrel） |
| **会话自动标题** | 首轮结束后确保会话有标题（模型摘要或本地截断） | `session-title.ts`（`ensureSessionTitle`） |
| **项目侧栏身份** | 按项目 key 分组 / 隐藏 / 显示名 / 删除后回退会话 | `shared/project-path.ts`、`group-sessions.ts`、`useWorkspaceSession.ts` |
| **Cwd 路径沙箱** | 解析项目内相对路径，拒绝逃出 cwd | `electron/agent/cwd-sandbox.ts` |
| **工作区 / 回合门面** | 跨进程粗操作面：`workspace` / `turn` / `plan` / `session` / `prefs` / … 分面（扁平方法仍保留兼容；新代码优先分面） | `shared/ipc.ts`、`preload.ts`；IPC 注册拆为 `register-workspace/turn/plan/session-config-ipc` |
| **工作区生命周期** | open / resume / dispose / createSession 编排 | `session-lifecycle.ts`；`SessionHost` 组合壳转发 |
| **计划会话** | 右栏计划 CRUD、脏保存、执行计划、自动打开 Plan 页 | `usePlanSession.ts`、`PlanTab.tsx` |
| **应用更新 UX** | 打包版检查 / 下载 / 安装 / 横幅 dismiss | `useAppUpdate.ts`；主进程 `auto-updater.ts` + `update-feed.ts`；IPC `register-update-ipc.ts` |

相关：[`AGENT_CONTEXT.md`](AGENT_CONTEXT.md)（模型上下文如何组装）、[`CLAUDE.md`](CLAUDE.md)（仓库指引）、[`docs/adr/`](docs/adr/)（架构决策）。
