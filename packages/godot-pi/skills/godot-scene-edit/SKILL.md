---
name: godot-scene-edit
description: Safely edit Godot scenes and scripts with minimal disruption. Use when changing .tscn/.gd files, wiring signals, or after structural scene edits that need an editor reload.
---

# Godot Scene Edit

## Guidelines

1. Prefer editing the smallest unit (one script or one scene subtree).
2. When changing node paths, update all `$Node` / `%Unique` references.
3. After structural scene edits, call `godot_reload_scene` with the scene path (X-agent Godot RPC) so the editor reloads from disk. If RPC tools are disabled or the editor is disconnected, remind the user to reopen the scene manually.
4. Keep `.tscn` formatting stable; avoid wholesale rewrites of large scenes.
5. For gameplay logic, prefer composition (child nodes + signals) over deep inheritance.

## RPC checklist

Enable Godot tools under **Settings → Tools** and keep the editor connected.

| After you… | Call |
|---|---|
| Edit `.tscn` on disk | `godot_reload_scene` |
| Change importable assets (png/wav/…) | `godot_import_resources` with those `res://` paths |
| Want to validate the edited scene | `godot_run_scene` then read errors |
| Want to validate project boot (main scene) | `godot_run_main_scene` |
| Need later errors while still playing | `godot_play_errors` |
| Done playing | `godot_stop_scene` |
