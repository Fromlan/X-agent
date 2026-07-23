---
name: godot-scene-edit
description: Safely edit Godot scenes and scripts with minimal disruption. Use when changing .tscn/.gd files or wiring signals.
---

# Godot Scene Edit

## Guidelines

1. Prefer editing the smallest unit (one script or one scene subtree).
2. When changing node paths, update all `$Node` / `%Unique` references.
3. After structural scene edits, call `godot_reload_scene` with the scene path (X-agent Godot RPC) so the editor reloads from disk. If RPC tools are disabled or the editor is disconnected, remind the user to reopen the scene manually.
4. Keep `.tscn` formatting stable; avoid wholesale rewrites of large scenes.
5. For gameplay logic, prefer composition (child nodes + signals) over deep inheritance.
