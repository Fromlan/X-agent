# Godot Editor RPC（X-agent）

Godot **4.x** 编辑器插件：以 TCP JSON-lines 客户端连入 X-agent 桌面桥，供 Agent 与 **设置 → Godot → 编辑器连接** 驱动编辑器（开/重载/运行场景、资源导入、收集运行期报错）。

| 层 | 路径 |
|---|---|
| 本包 Addon | `addons/x_agent_rpc/` |
| 协议类型 | [`apps/desktop/shared/godot-rpc.ts`](../../apps/desktop/shared/godot-rpc.ts) |
| 桌面桥接 | [`apps/desktop/electron/agent/godot-rpc-bridge.ts`](../../apps/desktop/electron/agent/godot-rpc-bridge.ts) |
| Agent 工具 | [`apps/desktop/electron/agent/godot-tools.ts`](../../apps/desktop/electron/agent/godot-tools.ts) |
| 安装助手 | [`apps/desktop/electron/agent/godot-addon-install.ts`](../../apps/desktop/electron/agent/godot-addon-install.ts) |

> 官方文档离线检索（`godot_docs_*`）是桌面侧能力，不经过本 addon；见主仓库 README「Godot 文档」。

## 安装

1. X-agent：**设置 → Godot → 编辑器连接 → 安装/更新 RPC 插件到当前项目**  
   （或手动拷贝 `addons/x_agent_rpc` 到项目 `addons/`）
2. Godot → 项目设置 → 插件 → 启用 **X-agent RPC**（不要启用其它同名替代插件）
3. 启动 X-agent；桥接监听 `127.0.0.1:8765`（占用时回退 `8765–8774`）
4. Endpoint 写入 `~/.pi/agent/x-agent-godot-rpc.json`，插件会自动重连
5. 设置页显示「已连接 Godot」；Godot 输出可见 `X-agent RPC: connected to …`

升级插件后请重新安装/拷贝，并 **重载项目或重启 Godot**。

## Agent 工具

在 **设置 → 工具** 中勾选 **Godot 编辑器** 相关项（默认关闭）：

| 工具 | RPC 方法 |
|---|---|
| `godot_editor_info` | `get_editor_info` |
| `godot_open_scenes` | `get_open_scenes` |
| `godot_edited_scene` | `get_edited_scene` |
| `godot_open_scene` | `open_scene` |
| `godot_reload_scene` | `reload_scene` |
| `godot_run_scene` | `run_current_scene`（+ `wait_ms`） |
| `godot_run_main_scene` | `play_main_scene`（+ `wait_ms`，等同 F5） |
| `godot_import_resources` | `import_resources`（可选 `paths`） |
| `godot_play_errors` | `get_play_errors` |
| `godot_stop_scene` | `stop_scene` |

## 运行报错收集

`run_current_scene` / `play_main_scene`（及对应工具）会清空缓冲、开始播放、等待（默认约 3s，最大 15s）后返回：

```json
{
  "started": true,
  "playing": true,
  "waitMs": 3000,
  "playMethod": "play_current_scene",
  "errors": [{ "severity": "error", "message": "…" }]
}
```

来源（`rpc_debugger.gd`）：Output 的 ERROR/WARN、调试器 Errors 页、断点原因。更长会话用 `get_play_errors`。插件**不会**因报错自动停止播放。

## 协议

每行一个 JSON。类型与超时见 [`godot-rpc.ts`](../../apps/desktop/shared/godot-rpc.ts)。

### 方法

| 方法 | 说明 |
|---|---|
| `ping` | 健康检查 |
| `get_editor_info` | 版本、项目路径、编辑中场景、播放状态 |
| `get_open_scenes` | 已打开场景页签 |
| `get_edited_scene` | 当前编辑场景 + 播放状态 |
| `open_scene` | 打开 `res://…` |
| `reload_scene` | 必要时先打开再重载 |
| `run_current_scene` | 运行当前场景（F6）；可选 `wait_ms` |
| `play_main_scene` | 运行项目主场景（F5）；可选 `wait_ms` |
| `import_resources` | `paths` 为空则全量 scan；否则 update + reimport |
| `get_play_errors` | 读取缓冲；可选 `clear: true` |
| `stop_scene` | 停止播放 |

**多编辑器**：桥接为每个 TCP 连接分配 id，用 `editor_ready` 记录 `projectPath`；请求发往**活动客户端**（设置 → Godot → 编辑器连接下拉）或显式 `clientId`。

### 事件（编辑器 → 桌面）

- `editor_ready` — 连接成功
- `scene_changed` — 编辑场景变化
- `play_error` — `{ severity, message }`

## Addon 结构

```
addons/x_agent_rpc/
  plugin.cfg
  plugin.gd       # TCP 客户端、RPC、错误缓冲
  rpc_debugger.gd # EditorDebuggerPlugin
```
