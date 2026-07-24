---
name: godot-rpc-playtest
description: Drive X-agent Godot editor RPC for playtesting and error triage. Use when running scenes, collecting debugger errors, importing assets, or debugging play-time failures via Godot tools.
---

# Godot RPC Playtest

## Preconditions

1. Desktop Godot RPC bridge is running (Settings → Godot RPC).
2. Project has **X-agent RPC** addon enabled (not a different addon).
3. Godot tools are enabled under Settings → Tools.
4. If multiple editors are connected, the active client in Settings routes RPC calls.

## Play flows

### Current scene (F6)

1. Optional: `godot_open_scene` / `godot_reload_scene` with `res://…`.
2. `godot_run_scene` with default `wait_ms` (~3000).
3. Read returned `errors`. Fix scripts/scenes for severity `error`.
4. For longer sessions, call `godot_play_errors` (optionally `clear: true`).
5. `godot_stop_scene` when finished.

### Main scene (F5)

1. `godot_run_main_scene` — uses project main scene from Project Settings.
2. Same error triage as above.

### After writing assets

1. `godot_import_resources` with specific `res://` paths, or omit paths for a full filesystem scan.
2. Then reload any open scenes that depend on those assets.

## Error reading tips

- Prefer fixing the first hard `error` before chasing warnings.
- Script parse errors often appear immediately; runtime errors may need a longer `wait_ms` (max 15000).
- If RPC returns `no Godot editor connected`, guide the user to install/enable the addon and reconnect.
