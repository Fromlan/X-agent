# X-agent Fleet

多 Agent 编排：每个 Fleet 槽位对应一个独立 `SessionHost`，桌面顶栏 Fleet 条切换活动槽位。实现位于 [`apps/desktop`](../../apps/desktop)，本目录仅作说明。

## 用户怎么用

1. **主会话**打开项目（编排以主会话 `cwd` 为准）
2. Fleet 条可「工作区」（worker）/「审阅」（reviewer），或点芯片旁 × 移除（忙碌/编排中不可删）
3. 输入任务后点 **「并行实现+审阅」**（不要用普通发送）：自动创建/复用实现与审阅槽，启动双波次编排，并切到实现槽
4. 实现+审阅同时存在且当前不在主会话时，聊天区 **左右双栏** 各自显示对话；点某一栏或芯片切换输入目标
5. Fleet 条显示 Wave1 / Wave2 / 完成；「中止编排」可停（Wave2 审阅结束前均可中止）

## 流程（实现）

1. 启动时创建 `primary`（「主会话」）及对应 `SessionHost`
2. 「工作区 / 审阅」创建 worker / reviewer 槽位 + Host；若主会话已有项目 `cwd`，会在同目录开新会话
3. `fleetSetActive`：活动 Host 负责 `prompt` / `abort` / 侧栏会话；各槽 **独立 transcript**
4. `agent:event` 载荷为 `{ slotId, event }`，**后台槽也推流**（不再因非活动而吞掉聊天事件）
5. 所有 Host 共享同一 `GodotRpcBridge`
6. `fleet:event`：`slot_status`（busy）/ `pair_progress` / `state`

## 并行编排（codegen-review）

IPC：`fleetStartPair(task)` / `fleetAbortPair()`。

| 模块 | 路径 |
|---|---|
| 编排器 | [`fleet-orchestrator.ts`](../../apps/desktop/electron/agent/fleet-orchestrator.ts) |
| Handoff | [`fleet-handoff.ts`](../../apps/desktop/electron/agent/fleet-handoff.ts)（unstaged + staged diff，否则 `git status`，再否则会话摘录） |
| Prompts | [`fleet-pair-prompts.ts`](../../apps/desktop/electron/agent/fleet-pair-prompts.ts) |

启动用 `SessionHost.beginPrompt`（只开火、不等整轮结束），避免 UI 卡住。

| 波次 | Worker | Reviewer |
|---|---|---|
| Wave1（并行） | 实现任务 / 改代码 | 风险清单与审查关注点 |
| Wave2（串接） | 已结束 | 基于 handoff 做具体审阅；**phase `done` = 审阅 `agent_end`** |

规则：

- 同时只允许一个进行中的 pair（在 `await` 槽位前即占位 `wave1`，防并发）
- 实现/审阅槽若已在 streaming/retrying，拒绝开编排
- primary 不参与自动 prompt，仅作 cwd 锚点
- busy 槽或编排中的槽不可移除

## 状态

| 项 | 状态 |
|---|---|
| Registry（内存） | `FleetRegistry` |
| 多 SessionHost | `FleetHostManager` |
| UI Fleet 条 | 角色 / busy / 移除 / 编排相位 |
| 分槽聊天 | `itemsBySlot` + 实现\|审阅双栏（优先绑定 pair 槽 ID） |
| IPC | `fleetList` / `fleetState` / `fleetCreate` / `fleetSetActive` / `fleetRemove` / `fleetStartPair` / `fleetAbortPair` |
| 事件 | `agent:event`（`SlotAgentEvent`）、`fleet:event` |
| 编排器 | `FleetOrchestrator`（双波次） |

## 已知限制

- 工具白名单 / 模型 / 资源重载仅应用到**活动槽**
- 多 worker/reviewer 时，双栏与 pair 绑定当前 pair 的槽；其它同角色槽需手动切芯片
- Godot RPC 桥在各槽间共享，并行 Godot 工具可能互抢

## 后续

- 第三波：把审阅意见自动写回 worker 修复
- 多 pair / 自定义角色图 / 跨 cwd 编排
