---
name: godot-connector-setup
description: Install and verify the Godot-side RPC addon that lets the godot-connector MiniMax Plugin drive the Godot editor. Use when the user asks to set up Godot integration, when `godot_editor_info` returns "no Godot editor connected", or when the addon needs to be reinstalled after an X-agent update.
---

<!-- argument-hint: [install | update | verify | troubleshoot] -->

# Godot Connector — Setup

The MiniMax Plugin `godot-connector` runs a local TCP bridge (`server.cjs` +
`bridge/bridge.mjs`) and exposes 28 tools that drive a Godot editor.  The
Godot side needs a matching addon (`x_agent_rpc`) that connects back over
TCP.  This skill walks through installing, verifying, and troubleshooting
that addon.

The addon is **byte-compatible** with the X-agent one — same wire protocol,
same handshake.  If you already have the X-agent addon installed, you can
keep using it; just point your MiniMax session at the same project.

## 1. Install the addon

The addon source lives in the X-agent repository at
`packages/godot-editor-rpc/addons/x_agent_rpc/` (3 files: `plugin.cfg`,
`plugin.gd`, `rpc_debugger.gd`).  Copy it into your Godot project's
`addons/x_agent_rpc/`.

```bash
# From the X-agent repo (clone once if you don't have it locally):
git clone --depth=1 https://github.com/Fromlan/X-agent.git /tmp/x-agent
cp -r /tmp/x-agent/packages/godot-editor-rpc/addons/x_agent_rpc \
      "<your-godot-project>/addons/x_agent_rpc"

# Or download just the directory (requires GitHub CLI):
gh api -H "Accept: application/vnd.github+json" \
   /repos/Fromlan/X-agent/contents/packages/godot-editor-rpc/addons/x_agent_rpc \
   | jq -r '.[] | .download_url' | xargs -n1 curl -sL -o "<file>"
```

Then in Godot:

1. **Project → Reload Project** (or restart the editor) so the new
   `addons/x_agent_rpc` is picked up.
2. **Project → Project Settings → Plugins** → enable **X-agent RPC** (the
   `x_agent_rpc` entry).  Do **not** enable any other addon with a similar
   name — duplicate addons on the same wire will race.

The addon is now listening for a bridge on `127.0.0.1:8765` (with fallback
8766–8774).  It writes nothing to disk; the bridge writes the endpoint
file (`${PLUGIN_DATA}/bridge-endpoint.json`) and the addon reads it.

## 2. Start the bridge

The MiniMax Plugin auto-starts the bridge via a `SessionStart` hook the
first time a session begins.  No manual step is needed.  If you want to
verify the bridge is up before invoking a tool:

```powershell
# PowerShell — check the endpoint file
Get-Content "$env:USERPROFILE\.minimax\plugins\cache\godot-connector\bridge-endpoint.json"
# Expect something like: { "host": "127.0.0.1", "port": 8765, "token": "<32-hex>", "version": 1, "updatedAt": "..." }

# Or probe the port directly
Test-NetConnection -ComputerName 127.0.0.1 -Port 8765
```

## 3. Verify

Ask MiniMax:

> Use `godot_editor_info` to show the currently running Godot editor state.

A successful call returns the editor version, project path, edited scene,
and play state.  If you get `no Godot editor connected`, jump to §5.

## 4. Update

When X-agent releases a new addon version, repeat §1 (re-copy the three
files), then **reload the project** or **restart Godot**.  The bridge will
reuse the same token, so the addon reconnects within ~1 second without
needing to re-enable the plugin.

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `no Godot editor connected` | Godot not running, or addon not enabled | Start Godot, enable **X-agent RPC** in Project Settings → Plugins |
| `Godot RPC handshake failed: token mismatch` | Stale token in endpoint file, addon too old | Update the addon (§4), restart Godot |
| `Godot RPC handshake failed: missing token` | Addon version < 0.2.0 (no token support) | Update the addon (§4) |
| `Port 8765 is already in use` | X-agent bridge also running, or another tool holding the port | Stop the other process, or set `GODOT_CONNECTOR_PORT=<free>` before starting MiniMax |
| Hook warning: `bridge did not become reachable within 5000ms` | Bridge crashed, see `bridge.log` | Check `${PLUGIN_DATA}/bridge.log` for stack trace; restart the session |
| All tools return `bridge unreachable` | `node` not on PATH, or firewall blocking 127.0.0.1 | Install Node.js 22+; verify localhost is not firewalled |
| `addon v0.2.x is older than expected v0.3.0` | Addon needs update | §4 |

### Where state lives

| Path | Owner | Purpose |
|---|---|---|
| `${PLUGIN_DATA}/bridge-endpoint.json` | bridge | Tells the addon where to connect |
| `${PLUGIN_DATA}/bridge.pid` | start-bridge.mjs | Bridge process id for liveness checks |
| `${PLUGIN_DATA}/bridge.log` | bridge | Diagnostic log (append-only) |
| `${PLUGIN_DATA}/last-client.json` | bridge | Last connected Godot client info |

On Windows, `${PLUGIN_DATA}` typically resolves to
`C:\Users\<user>\.minimax\plugins\cache\godot-connector\`.

## 6. Coexistence with X-agent

Both MiniMax and X-agent can drive the same Godot project **as long as only
one bridge is running on the host**.  By default both target port 8765.  If
you need to run X-agent at the same time, set a non-default port for the
godot-connector bridge:

```powershell
$env:GODOT_CONNECTOR_PORT = 8766
# Then start MiniMax Code
```

The addon reads the port from the endpoint file, so the new value is
picked up automatically.  Stop the bridge (`node bridge/stop-bridge.mjs`)
before re-launching with the new port.

## Requirements

- **Node.js 22+** on `PATH` (the bridge and MCP server are pure Node).
- **Godot 4.x** (the addon uses `EditorPlugin` + `TCPServer`).
- **Localhost access** (the bridge binds `127.0.0.1`; remote hosts are
  refused for safety).
