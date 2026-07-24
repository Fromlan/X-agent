# X-agent Fleet

多 Agent 编排：每个 Fleet 槽位对应一个独立 `SessionHost`，桌面顶栏 Fleet 条切换活动槽位。实现位于 [`apps/desktop`](../../apps/desktop)，本目录仅作说明。

## 流程

1. 启动时创建 `primary`（「主会话」）及对应 `SessionHost`
2. 「添加工作区」创建 worker 槽位 + Host；若主会话已有项目 `cwd`，worker 会在同目录开新会话
3. 点击芯片 → `fleetSetActive`：非活动 Host 不再向 UI `emit`；活动 Host 调用 `resyncUi()` 推送历史与会话信息
4. 会话相关 IPC（`prompt`、`openProject` 等）均经 `FleetHostManager.getActiveHost()`
5. 所有 Host 共享同一 `GodotRpcBridge`

## 状态

| 项 | 状态 |
|---|---|
| Registry（内存） | 已实现 `FleetRegistry` |
| 并行 SessionHost | 已实现 `FleetHostManager` |
| UI Fleet 条 | 已实现（TopBar 下方） |
| IPC | `fleetList` / `fleetState` / `fleetCreate` / `fleetSetActive` / `fleetRemove`（不可删 primary / 最后一个） |

## 后续

Worker / reviewer 角色的并行编排策略（例如同时跑 codegen 与 review）仍可深化；当前以「多 Host + 切换查看」为主。
