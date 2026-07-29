---
name: godot-gdscript-patterns
description: Godot 4 GDScript patterns for signals, scenes, and performance. Use when implementing gameplay scripts or applying GDScript best practices.
---

# GDScript patterns

Aligned with Godot 4.x GDScript basics / scene unique nodes.

## Prefer

- Typed vars and casts (`x as Node`). Node shortcuts: `$NodePath` → `get_node("NodePath")`, `%UniqueNode` → `get_node("%UniqueNode")`.
- **Scene unique names (`%`)** only resolve **inside the same scene**. From a parent that instances another scene, use a path such as `$Hand/Sword/%Hilt` (or `get_node` on the instanced root first).
- Signals for decoupled events; avoid deep string node paths for everything.
- Wire node refs in `_ready` or with `@onready`; defer heavy work off the first frame when it causes jank.
- Composition over giant `match` god-scripts (pair with custom FSM / child components — not engine builtins).

## Avoid

- Busy `_process` without early-outs.
- Hard-coded fragile paths that break on UI moves (prefer `%` unique names or exported `NodePath` / `@onready` caches).
- Blocking file/network IO on the main thread in hot paths.
