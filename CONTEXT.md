# X-agent 领域词表

维护者与架构加深共用的概念名。接缝与模块以这些词指称，避免与文件名偶然碰撞混淆。

| 概念 | 含义 | 主要落点 |
|------|------|----------|
| **对话实录保真** | Pi 分支 / 流式 → 同一套 `HistoryItem` 规则（文本、工具配对、`userEntryId`、截断） | `electron/agent/transcript-mapper.ts`、`history.ts`、`chat-store.ts` |
| **撤回撤销** | 撤回到用户消息：abort → navigate → 文件还原 → 剪枝 → history replace | `turn-file-tracker.ts`、`SessionHost.retractToUserMessage` |
| **供应商激活** | 写 Pi auth/models + prefs + 运行时 reload + 失败回滚，一次事务 | `provider-activate.ts`、`provider-store.ts` |
| **会话自动标题** | 首轮结束后确保会话有标题（模型摘要或本地截断） | `session-title.ts`（`ensureSessionTitle`） |
| **项目侧栏身份** | 按项目 key 分组 / 隐藏 / 显示名 / 删除后回退会话 | `shared/project-path.ts`、`group-sessions.ts` |
| **Cwd 路径沙箱** | 解析项目内相对路径，拒绝逃出 cwd | `electron/agent/cwd-sandbox.ts` |
| **工作区 / 回合门面** | 跨进程粗操作面（打开工作区、回合、撤回）；Godot / 插件 / 供应商分接缝 | `shared/ipc.ts`、`preload.ts`、`main` handlers、`App` 壳 |

相关：[`AGENT_CONTEXT.md`](AGENT_CONTEXT.md)（模型上下文如何组装）、[`CLAUDE.md`](CLAUDE.md)（仓库指引）。
