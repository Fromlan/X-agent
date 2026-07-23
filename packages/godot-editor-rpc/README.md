# Godot Editor RPC (X-agent)

Godot **4.x** editor addon that connects to the X-agent desktop TCP JSON-lines bridge so the Agent (and Settings UI) can drive the editor: open/reload/run scenes, and collect play-time debugger errors.

| Layer | Path |
|---|---|
| Addon (this package) | `addons/x_agent_rpc/` |
| Protocol types | [`apps/desktop/shared/godot-rpc.ts`](../../apps/desktop/shared/godot-rpc.ts) |
| Desktop bridge | [`apps/desktop/electron/agent/godot-rpc-bridge.ts`](../../apps/desktop/electron/agent/godot-rpc-bridge.ts) |
| Agent tools | [`apps/desktop/electron/agent/godot-tools.ts`](../../apps/desktop/electron/agent/godot-tools.ts) |
| Install helper | [`apps/desktop/electron/agent/godot-addon-install.ts`](../../apps/desktop/electron/agent/godot-addon-install.ts) |

## Install

1. In X-agent: **设置 → Godot RPC → 安装/更新 RPC 插件到当前项目**  
   (or copy `addons/x_agent_rpc` into the Godot project’s `addons/`, replacing on upgrade).
2. Godot → Project → Project Settings → Plugins → enable **X-agent RPC** (not a different `godot_agent` addon).
3. Start X-agent desktop. The bridge listens on `127.0.0.1:8765`, or the next free port in `8765–8774` if busy.
4. Active endpoint is written to `~/.pi/agent/x-agent-godot-rpc.json` so the addon can reconnect automatically.
5. Settings status should show「已连接 Godot」. Godot Output should print `X-agent RPC: connected to …`.

After upgrading the addon, re-install/copy and **reload the project or restart Godot**.

## Agent tools

Enable under **设置 → 工具 → Godot 编辑器** (opt-in; off by default):

| Tool | RPC method |
|---|---|
| `godot_editor_info` | `get_editor_info` |
| `godot_open_scenes` | `get_open_scenes` |
| `godot_edited_scene` | `get_edited_scene` |
| `godot_open_scene` | `open_scene` |
| `godot_reload_scene` | `reload_scene` |
| `godot_run_scene` | `run_current_scene` (+ `wait_ms`) |
| `godot_play_errors` | `get_play_errors` |
| `godot_stop_scene` | `stop_scene` |

## Play error capture

`run_current_scene` / `godot_run_scene` clears the buffer, plays the current scene, waits (~3s by default, max 15s), then returns:

```json
{
  "started": true,
  "playing": true,
  "waitMs": 3000,
  "errors": [{ "severity": "error", "message": "…" }]
}
```

Sources (`rpc_debugger.gd`):

- Output dock ERROR/WARN lines (`ScriptEditorDebugger.output`)
- Debugger **Errors** tab (`debug_data` with `msg == "error"`)
- Debugger break reasons (`breaked`)

Use `get_play_errors` / `godot_play_errors` for longer sessions. The addon does **not** auto-stop on error.

## Protocol

Newline-delimited JSON. See [`godot-rpc.ts`](../../apps/desktop/shared/godot-rpc.ts) for TypeScript types and timeout helpers.

### Methods

| Method | Description |
|---|---|
| `ping` | Health check |
| `get_editor_info` | Godot version, project path, edited scene, play state |
| `get_open_scenes` | Open scene tab paths |
| `get_edited_scene` | Active edited scene path + play state |
| `open_scene` | Open `path` (`res://…`) |
| `reload_scene` | Open if needed, then reload `path` |
| `run_current_scene` | Play current scene; optional `wait_ms` (default 3000) collects errors |
| `get_play_errors` | Read buffered play errors; optional `clear: true` |
| `stop_scene` | Stop playing |

### Events (client → desktop)

- `editor_ready` — on connect
- `scene_changed` — edited scene changed
- `play_error` — `{ severity, message }` while playing / debugging

## Addon layout

```
addons/x_agent_rpc/
  plugin.cfg      # EditorPlugin metadata
  plugin.gd       # TCP client, RPC handlers, error buffer
  rpc_debugger.gd # EditorDebuggerPlugin — hooks output / debug_data / break
```
