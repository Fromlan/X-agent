---
name: godot-scene-edit
description: Safely edit Godot scenes and scripts with minimal disruption. Use when changing .tscn/.gd files, wiring signals, or after structural scene edits that need an editor reload.
---

# Godot scene edit

## Discipline

1. Prefer editing `.gd` logic over hand-rewriting large `.tscn` blobs when possible.
2. Keep node paths and **scene unique names** (`%`) stable unless the task requires renames; remember `%` is same-scene only.
3. Wire signals explicitly in the editor or via code (`connect` / `Callable`); avoid silent broken connections.
4. After structural scene or script class changes, **reload** in the editor if Godot RPC tools are enabled (`reload_scene` / open the scene).

## Verify

- Script parse errors (read file; or playtest skill).
- If RPC available: reload, then ask whether to run the current/main scene.
